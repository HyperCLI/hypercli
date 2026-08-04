import {
  DEFAULT_THEME,
  LEGACY_THEME_KEY,
  THEME_COOKIE_NAME,
  THEME_FAMILY_COOKIE_NAME,
  THEME_FAMILY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  getThemeMode,
} from "../utils/theme";
import { DEFAULT_PLAN_TIER, PLAN_TIER_COOKIE_NAME } from "../utils/plan-tier";

export interface ThemeScriptProps {
  nonce?: string;
}

function serialize(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function createThemeScript(configuredCookieDomain: string, configuredApiBase: string): string {
  return `(function(){
var modeKey=${serialize(THEME_COOKIE_NAME)};
var familyKey=${serialize(THEME_FAMILY_COOKIE_NAME)};
var legacyKey=${serialize(LEGACY_THEME_KEY)};
var planTierKey=${serialize(PLAN_TIER_COOKIE_NAME)};
var authKey="auth_token";
var logoutKey="hypercli_logged_out";
var configuredApiBase=${serialize(configuredApiBase)};
var fallbackMode=${serialize(getThemeMode(DEFAULT_THEME))};
var maxAge=31536000;
var configuredDomain=${serialize(configuredCookieDomain)};
var normalizeMode=function(value){return value==="dark"||value==="light"?value:null;};
var normalizeTheme=function(value){return value==="dark"||value==="light"||value==="aurora-dark"||value==="aurora-light"?value:null;};
var normalizeLegacy=function(value){return value==="default"||value==="green"?"dark":normalizeTheme(value);};
var modeOf=function(theme){return theme==="light"||theme==="aurora-light"?"light":"dark";};
var compose=function(family,mode){return family==="aurora"?"aurora-"+mode:mode;};
var readCookie=function(name,normalizer){var cookies;try{cookies=document.cookie;}catch(error){return null;}var parts=cookies.split(";");for(var index=0;index<parts.length;index++){var part=parts[index];var separator=part.indexOf("=");if(separator<0||part.slice(0,separator).trim()!==name)continue;try{var value=normalizer(decodeURIComponent(part.slice(separator+1).trim()));if(value!==null)return value;}catch(error){}}return null;};
var readStorage=function(name,normalizer){try{return normalizer(window.localStorage.getItem(name));}catch(error){return null;}};
var identity=function(value){return value;};
var normalizeTier=function(value){return value==="solo"||value==="team"||value==="enterprise"?value:null;};
var tokenSubject=function(token){try{var encoded=token.split(".")[1];if(!encoded)return null;var base64=encoded.replace(/-/g,"+").replace(/_/g,"/");var padded=base64+"=".repeat((4-base64.length%4)%4);var payload=JSON.parse(window.atob(padded));var expiresAt=Number(payload.exp);if(!Number.isFinite(expiresAt)||Date.now()>=expiresAt*1000-60000)return null;var value=payload.sub||payload.user_id||payload.userId||payload.id;return typeof value==="string"&&value.trim()?value.trim():null;}catch(error){return null;}};
var environment=function(){try{var origin=window.location.origin||(window.location.protocol+"//"+window.location.hostname);var parsed=new URL(configuredApiBase||origin,origin);var pathname=parsed.pathname.replace(/\\/+$/,"").replace(/\\/(?:api|agents)$/i,"");return (parsed.origin+pathname).toLowerCase();}catch(error){return (configuredApiBase||"").replace(/\\/+$/,"").replace(/\\/(?:api|agents)$/i,"").toLowerCase();}};
var activeToken=function(){var candidates=[readCookie(authKey,identity),readStorage("claw_auth_token",identity),readStorage("app_auth_token",identity)];for(var index=0;index<candidates.length;index++){if(candidates[index]&&tokenSubject(candidates[index]))return candidates[index];}return null;};
var resolvePlanTier=function(){var cachedRaw=readCookie(planTierKey,identity);var authToken=activeToken();if(readCookie(logoutKey,identity)||!cachedRaw||!authToken)return ${serialize(DEFAULT_PLAN_TIER)};try{var cached=JSON.parse(cachedRaw);var tier=normalizeTier(cached.tier);var subject=tokenSubject(authToken);if(cached.version!==1||!tier||!subject||cached.subject!==subject||cached.environment!==environment()||typeof cached.expiresAt!=="number"||cached.expiresAt<=Date.now())return ${serialize(DEFAULT_PLAN_TIER)};return tier;}catch(error){return ${serialize(DEFAULT_PLAN_TIER)};}};
var cookieTheme=readCookie(modeKey,normalizeTheme);
var cookieMode=cookieTheme?modeOf(cookieTheme):readCookie(modeKey,normalizeMode);
var legacyCookieTheme=readCookie(legacyKey,normalizeLegacy);
var storedTheme=readStorage(modeKey,normalizeTheme);
var storedMode=storedTheme?modeOf(storedTheme):readStorage(modeKey,normalizeMode);
var legacyStoredTheme=readStorage(legacyKey,normalizeLegacy);
var mode=cookieMode||(legacyCookieTheme&&modeOf(legacyCookieTheme))||storedMode||(legacyStoredTheme&&modeOf(legacyStoredTheme))||fallbackMode;
var family="aurora";
var theme=compose(family,mode);
var root=document.documentElement;
root.setAttribute("data-theme",theme);
root.setAttribute("data-color-mode",mode);
root.setAttribute("data-plan-tier",resolvePlanTier());
root.style.colorScheme=mode;
var isLocal=function(hostname){return !hostname||hostname==="localhost"||hostname.slice(-10)===".localhost"||hostname==="127.0.0.1"||hostname==="0.0.0.0"||hostname==="[::1]"||/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(hostname)||hostname.indexOf(":")!==-1;};
var writeCookie=function(name,value){try{var hostname=window.location.hostname.trim().toLowerCase();var domain=configuredDomain.trim().toLowerCase().replace(/^\\.+/,"");var domainPart="";if(!isLocal(hostname)&&domain&&domain!=="localhost"&&(hostname===domain||hostname.slice(-(domain.length+1))==="."+domain)){domainPart="; Domain=."+domain;}var secure=window.location.protocol==="https:"?"; Secure":"";if(domainPart)document.cookie=name+"=; Path=/; Max-Age=0; SameSite=Lax"+secure;document.cookie=name+"="+value+"; Path=/; Max-Age="+maxAge+"; SameSite=Lax"+domainPart+secure;}catch(error){}};
writeCookie(modeKey,mode);
writeCookie(familyKey,family);
try{window.localStorage.setItem(${serialize(THEME_STORAGE_KEY)},mode);window.localStorage.setItem(${serialize(THEME_FAMILY_STORAGE_KEY)},family);}catch(error){}
})();`;
}

function createThemeReconciliationScript(configuredApiBase: string): string {
  return `(function(){
if(typeof window.addEventListener!=="function")return;
var modeKey=${serialize(THEME_COOKIE_NAME)};
var familyKey=${serialize(THEME_FAMILY_COOKIE_NAME)};
var legacyKey=${serialize(LEGACY_THEME_KEY)};
var planTierKey=${serialize(PLAN_TIER_COOKIE_NAME)};
var authKey="auth_token";
var logoutKey="hypercli_logged_out";
var configuredApiBase=${serialize(configuredApiBase)};
var normalizeMode=function(value){return value==="dark"||value==="light"?value:null;};
var normalizeTheme=function(value){return value==="dark"||value==="light"||value==="aurora-dark"||value==="aurora-light"?value:null;};
var normalizeLegacy=function(value){return value==="default"||value==="green"?"dark":normalizeTheme(value);};
var modeOf=function(theme){return theme==="light"||theme==="aurora-light"?"light":"dark";};
var compose=function(family,mode){return family==="aurora"?"aurora-"+mode:mode;};
var readCookie=function(name,normalizer){var cookies;try{cookies=document.cookie;}catch(error){return null;}var parts=cookies.split(";");for(var index=0;index<parts.length;index++){var part=parts[index];var separator=part.indexOf("=");if(separator<0||part.slice(0,separator).trim()!==name)continue;try{var value=normalizer(decodeURIComponent(part.slice(separator+1).trim()));if(value!==null)return value;}catch(error){}}return null;};
var readStorage=function(name,normalizer){try{return normalizer(window.localStorage.getItem(name));}catch(error){return null;}};
var identity=function(value){return value;};
var normalizeTier=function(value){return value==="solo"||value==="team"||value==="enterprise"?value:null;};
var tokenSubject=function(token){try{var encoded=token.split(".")[1];if(!encoded)return null;var base64=encoded.replace(/-/g,"+").replace(/_/g,"/");var padded=base64+"=".repeat((4-base64.length%4)%4);var payload=JSON.parse(window.atob(padded));var expiresAt=Number(payload.exp);if(!Number.isFinite(expiresAt)||Date.now()>=expiresAt*1000-60000)return null;var value=payload.sub||payload.user_id||payload.userId||payload.id;return typeof value==="string"&&value.trim()?value.trim():null;}catch(error){return null;}};
var environment=function(){try{var origin=window.location.origin||(window.location.protocol+"//"+window.location.hostname);var parsed=new URL(configuredApiBase||origin,origin);var pathname=parsed.pathname.replace(/\\/+$/,"").replace(/\\/(?:api|agents)$/i,"");return (parsed.origin+pathname).toLowerCase();}catch(error){return (configuredApiBase||"").replace(/\\/+$/,"").replace(/\\/(?:api|agents)$/i,"").toLowerCase();}};
var activeToken=function(){var candidates=[readCookie(authKey,identity),readStorage("claw_auth_token",identity),readStorage("app_auth_token",identity)];for(var index=0;index<candidates.length;index++){if(candidates[index]&&tokenSubject(candidates[index]))return candidates[index];}return null;};
var resolvePlanTier=function(){var cachedRaw=readCookie(planTierKey,identity);var authToken=activeToken();if(readCookie(logoutKey,identity)||!cachedRaw||!authToken)return ${serialize(DEFAULT_PLAN_TIER)};try{var cached=JSON.parse(cachedRaw);var tier=normalizeTier(cached.tier);var subject=tokenSubject(authToken);if(cached.version!==1||!tier||!subject||cached.subject!==subject||cached.environment!==environment()||typeof cached.expiresAt!=="number"||cached.expiresAt<=Date.now())return ${serialize(DEFAULT_PLAN_TIER)};return tier;}catch(error){return ${serialize(DEFAULT_PLAN_TIER)};}};
var resolve=function(){var cookieTheme=readCookie(modeKey,normalizeTheme);var legacyCookieTheme=readCookie(legacyKey,normalizeLegacy);var storedTheme=readStorage(modeKey,normalizeTheme);var legacyStoredTheme=readStorage(legacyKey,normalizeLegacy);var mode=(cookieTheme&&modeOf(cookieTheme))||readCookie(modeKey,normalizeMode)||(legacyCookieTheme&&modeOf(legacyCookieTheme))||(storedTheme&&modeOf(storedTheme))||readStorage(modeKey,normalizeMode)||(legacyStoredTheme&&modeOf(legacyStoredTheme))||"dark";var family="aurora";return {theme:compose(family,mode),mode:mode,family:family,tier:resolvePlanTier()};};
var apply=function(value){var root=document.documentElement;root.setAttribute("data-theme",value.theme);root.setAttribute("data-color-mode",value.mode);root.setAttribute("data-plan-tier",value.tier);root.style.colorScheme=value.mode;if(document.body){document.body.setAttribute("data-theme",value.theme);document.body.setAttribute("data-color-mode",value.mode);document.body.setAttribute("data-plan-tier",value.tier);}try{window.localStorage.setItem(${serialize(THEME_STORAGE_KEY)},value.mode);window.localStorage.setItem(${serialize(THEME_FAMILY_STORAGE_KEY)},value.family);}catch(error){}};
var synchronize=function(){apply(resolve());};
window.addEventListener("focus",synchronize);
window.addEventListener("pageshow",synchronize);
window.addEventListener("storage",function(event){if(event.key===modeKey||event.key===familyKey||event.key===legacyKey)synchronize();});
if(typeof document.addEventListener==="function")document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")synchronize();});
})();`;
}

export function ThemeScript({ nonce }: ThemeScriptProps) {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || "";
  const script = createThemeScript(process.env.NEXT_PUBLIC_COOKIE_DOMAIN || "", apiBaseUrl) + createThemeReconciliationScript(apiBaseUrl);
  return (
    <script
      id="hypercli-theme-script"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
