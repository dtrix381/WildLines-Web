import 'dotenv/config';
import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';

const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>readFileSync(path.join(root,name),'utf8');
const html=read('Jackpot-Jess-Bingo.html');
const payload=html.match(/<script id="bingo-package" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
if(!payload)throw Error('The HTML game package is missing or damaged.');
const bundle=JSON.parse(payload);
const source=bundle.backend.replace('/*CATALOG*/[]',()=>JSON.stringify(bundle.catalog)).replace('/*HTML*/""',()=>JSON.stringify(html));
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const databasePath=process.env.DATABASE_PATH||path.join(root,'data/bingo.sqlite');
mkdirSync(path.dirname(databasePath),{recursive:true});
const sqlite=new DatabaseSync(databasePath);
sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');

let dbVersion=sqlite.prepare('PRAGMA user_version').get().user_version;

if(dbVersion===0){
  sqlite.exec('BEGIN;'+bundle.schema+'; PRAGMA user_version=1; COMMIT;');
  dbVersion=1;
}

if(dbVersion<2){
  sqlite.exec('BEGIN; ALTER TABLE players ADD COLUMN kick_user_id TEXT; CREATE UNIQUE INDEX players_room_kick_user_idx ON players(room_code,kick_user_id); PRAGMA user_version=2; COMMIT;');
}
const oauthStates = new Map();

const adminKickUserIds = new Set(
  (process.env.ADMIN_KICK_USER_IDS || '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
);

function isAdminKickUser(userId) {
  return adminKickUserIds.has(String(userId));
}


const loginSessions = new Map();

function createLoginSession(profile) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  loginSessions.set(tokenHash, {
    userId: profile.userId,
    username: profile.username,
    isAdmin: isAdminKickUser(profile.userId),
    expiresAt: Date.now() + 24 * 60 * 60 * 1000
  });

  return token;
}

function getLoginSession(req) {
  const cookies = req.headers.cookie || '';
  const match = cookies.match(/(?:^|;\s*)bingo_login=([^;]+)/);

  if (!match) return null;

  const tokenHash = createHash('sha256')
    .update(decodeURIComponent(match[1]))
    .digest('hex');

  const session = loginSessions.get(tokenHash);

  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    loginSessions.delete(tokenHash);
    return null;
  }

  return session;
}

function createKickLoginUrl(returnTo='/') {
  const clientId = process.env.KICK_CLIENT_ID;
  const redirectUri = process.env.KICK_REDIRECT_URI;

  if (!clientId || !redirectUri || !process.env.KICK_CLIENT_SECRET) {
    throw new Error('Kick OAuth credentials are missing from .env');
  }

  const state = randomBytes(32).toString('hex');
  const verifier = randomBytes(32).toString('base64url');

  const challenge = createHash('sha256')
    .update(verifier)
    .digest('base64url');

  oauthStates.set(state, {
    verifier,
    returnTo,
    expiresAt: Date.now() + 10 * 60 * 1000
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'user:read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  });

  return 'https://id.kick.com/oauth/authorize?' + params.toString();
}

async function finishKickLogin(url) {
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');

  const saved = state ? oauthStates.get(state) : null;

  if (state) oauthStates.delete(state);

  if (!saved || saved.expiresAt < Date.now() || !code) {
    throw new Error('Invalid or expired Kick login session.');
  }

  const tokenResponse = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.KICK_CLIENT_ID,
      client_secret: process.env.KICK_CLIENT_SECRET,
      redirect_uri: process.env.KICK_REDIRECT_URI,
      code,
      code_verifier: saved.verifier
    })
  });

  if (!tokenResponse.ok) {
    throw new Error('Kick token exchange failed.');
  }

  const tokenData = await tokenResponse.json();

  const profileResponse = await fetch('https://api.kick.com/public/v1/users', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`
    }
  });

  if (!profileResponse.ok) {
    throw new Error('Could not retrieve your Kick profile.');
  }

  const profileData = await profileResponse.json();
  const profile = profileData.data?.[0];

  if (!profile?.user_id) {
    throw new Error('Kick did not return a valid user ID.');
  }

  return {
    userId: String(profile.user_id),
    username: profile.name || 'Unknown',
    returnTo: saved.returnTo || '/'
  };
}

const DB={prepare(sql){return {bind(...args){return {
  async run(){const result=sqlite.prepare(sql).run(...args);return {meta:{changes:result.changes}}},
  async first(){return sqlite.prepare(sql).get(...args)||null},
  async all(){return {results:sqlite.prepare(sql).all(...args)}}
}}}}};
const host='0.0.0.0',port=Number(process.env.PORT||4173);
const server=http.createServer(async(req,res)=>{
  try{
    const base='http://'+(req.headers.host||'localhost:'+port),url=new URL(req.url,base);
    
    // Start Kick login
    if (req.method === 'GET' && url.pathname === '/oauth/kick/start') {
      try {
        const returnTo = url.searchParams.get('return') || '/';
        if (!returnTo.startsWith('/') || returnTo.startsWith('//')) throw new Error('Invalid return address.');
        const loginUrl = createKickLoginUrl(returnTo);
        res.writeHead(302, { Location: loginUrl });
        res.end();
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(error.message);
      }
      return;
    }

    // Complete Kick login and display the account ID
    if (req.method === 'GET' && url.pathname === '/oauth/kick/callback') {
      try {
        const profile = await finishKickLogin(url);

        const loginToken = createLoginSession(profile);

        const secureCookie = req.headers['x-forwarded-proto'] === 'https';

        const cookie =
          'bingo_login=' + encodeURIComponent(loginToken) +
          '; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400' +
          (secureCookie ? '; Secure' : '');

        res.writeHead(302, {
          Location: profile.returnTo,
          'Set-Cookie': cookie
        });
        res.end();

      } catch (error) {
        console.error('Kick login error:', error.message);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Kick login failed: ' + error.message);
      }
      return;
    }

    let size=0,chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>1500000){res.writeHead(413);res.end('Request too large');return}chunks.push(chunk)}
    const body=Buffer.concat(chunks);
    const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,...(body.length?{body}: {})}),{DB,AUTH:getLoginSession(req)});
    const responseBody=Buffer.from(await response.arrayBuffer());
    if(response.status>=500)console.error('GAME BACKEND ERROR:',response.status,responseBody.toString('utf8'));
    res.writeHead(response.status,Object.fromEntries(response.headers));
    res.end(responseBody);
  }catch(error){console.error('FULL SERVER ERROR:', error.stack || error);res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Local server error. Check the server window.'}))}
});
server.listen(port,host,()=>console.log('Slot Bingo is running at http://localhost:'+port+'\nKeep this window open. Press Ctrl+C to stop.'));
server.on('error',error=>{console.error(error.message);process.exitCode=1;sqlite.close()});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>{sqlite.close();process.exit()}));
