const OAUTH_STATE_COOKIE = "dpp_oauth_state";
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

function setOAuthStateCookie(res, { state, nonce, codeVerifier }) {
  res.cookie(OAUTH_STATE_COOKIE, JSON.stringify({ state, nonce, codeVerifier }), {
    httpOnly: true,
    // Altijd secure+SameSite=None (los van NODE_ENV): Entra stuurt de authorization code
    // terug via een cross-site POST (response_mode=form_post). SameSite=Lax wordt dan
    // NIET meegestuurd door de browser (Lax dekt alleen top-level GET-navigatie), dus
    // elke login zou stuklopen. SameSite=None vereist Secure — dat werkt ook lokaal over
    // http://localhost, omdat browsers "localhost" als secure context behandelen.
    secure: true,
    sameSite: "none",
    signed: true,
    maxAge: OAUTH_STATE_MAX_AGE_MS,
    path: "/"
  });
}

// Eenmalig te gebruiken: leest en wist de cookie in dezelfde stap, zodat een
// authorization code niet tweemaal met dezelfde state-waarde kan worden ingewisseld.
function consumeOAuthStateCookie(req, res) {
  const raw = req.signedCookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

module.exports = { setOAuthStateCookie, consumeOAuthStateCookie };
