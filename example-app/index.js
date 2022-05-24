import express from 'express';
import randomstring from 'randomstring';
import * as jose from 'jose';
import fetch from 'node-fetch';

const app = express();
const port = parseInt(process.env.PORT, 10) || 8080;

const AUTH_HOST = process.env.AUTH_HOST || 'https://auth.eks.codebrick.io';
const CLIENT_ID = process.env.CLIENT_ID || 'client-1';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'client-1-secret';
const REDIRECT_URI = process.env.REDIRECT_URI || `http://localhost:${port}/oauth_callback`;
const JWKS = jose.createRemoteJWKSet(new URL(AUTH_HOST + '/.well-known/jwks.json'));

class SillyStateStore {
    constructor() {
        this.states = {};
    }

    get(state) {
        return this.states[state];
    }

    delete(state) {
        delete this.states[state];
    }

    set(state) {
        this.states[state] = true;
    }
}
const stateStore = new SillyStateStore();

app.set('view engine', 'pug');

app.get('/', (req, res) => {
    res.render('index', {
        auth_host: AUTH_HOST
    })
});

app.listen(port, () => {
    console.log(`example client is running on port ${port}`);
});

app.get('/signin', (req, res) => {
    // Generate 'state' and store it. 'state' is used for preventing cross-site request forgery.
    const state = randomstring.generate();
    stateStore.set(state);

    // Request authorization by redirecting the user to the authorization endpoint.
    res.redirect(`${AUTH_HOST}/auth?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=openid+profile&state=${state}`);
});

app.get('/oauth_callback', async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;

    // Check 'state' is same as you sent.
    const storedState = stateStore.get(state);
    if (!storedState) {
        res.render('error', {error: 'Invalid state'});
        return;
    }
    stateStore.delete(state);

    // Exchange code for tokens.
    let json
    try {
        const response = await fetch(`${AUTH_HOST}/oauth/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
            },
            body: `grant_type=authorization_code&code=${code}&redirect_uri=${REDIRECT_URI}`
        });

        // You'll get access_token and id_token. id_token contains user's identity information.
        json = await response.json();
        console.log(json);

    } catch (e) {
        console.error('failed to exchange code:' + e);
        res.render('error', {error: e.toString()});
        return;
    }

    // Verify id_token before using it.
    let idTokenPayload
    try {
        const { payload } = await jose.jwtVerify(json.id_token, JWKS, {
            issuer: 'https://accounts.eks.codebrick.io',
            audience: CLIENT_ID,
        });
        idTokenPayload = payload
    } catch (e) {
        console.error('failed to verify id_token:' + e);
        res.render('error', {error: e.toString()});
        return;
    }
    console.log(idTokenPayload);

    // Now using payload of id_token, you can identify the user.
    // 'sub', which is abbreviation of subject, is the user's identifier.
    // Create a session or proceed to additional sign-up step if the user visits the site for the first time.



    res.render('success', {
        response: json,
        token_payload: idTokenPayload,
        signout_url: `${AUTH_HOST}/signout`,
    });
});
