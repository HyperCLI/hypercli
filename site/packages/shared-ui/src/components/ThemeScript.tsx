export interface ThemeScriptProps {
  nonce?: string;
}

function serialize(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function createThemeScript(configuredCookieDomain: string): string {
  return `(function(){var key="hypercli_color_theme";var legacyKey="hypercli_theme";var fallback="dark";var maxAge=31536000;var configuredDomain=${serialize(configuredCookieDomain)};var normalize=function(value){return value==="dark"||value==="light"?value:null;};var normalizeLegacy=function(value){return value==="default"||value==="green"?"dark":normalize(value);};var readCookie=function(name,normalizer){var cookies;try{cookies=document.cookie;}catch(error){return null;}var parts=cookies.split(";");for(var index=0;index<parts.length;index++){var part=parts[index];var separator=part.indexOf("=");if(separator<0||part.slice(0,separator).trim()!==name)continue;try{var theme=normalizer(decodeURIComponent(part.slice(separator+1).trim()));if(theme)return theme;}catch(error){}}return null;};var readStorage=function(name,normalizer){try{return normalizer(window.localStorage.getItem(name));}catch(error){return null;}};var cookieTheme=readCookie(key,normalize);var theme=cookieTheme||readCookie(legacyKey,normalizeLegacy)||readStorage(key,normalize)||readStorage(legacyKey,normalizeLegacy)||fallback;var root=document.documentElement;root.setAttribute("data-theme",theme);root.style.colorScheme=theme;var isLocal=function(hostname){return !hostname||hostname==="localhost"||hostname.slice(-10)===".localhost"||hostname==="127.0.0.1"||hostname==="0.0.0.0"||hostname==="[::1]"||/^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(hostname)||hostname.indexOf(":")!==-1;};var writeCookie=function(value){try{var hostname=window.location.hostname.trim().toLowerCase();var domain=configuredDomain.trim().toLowerCase().replace(/^\\.+/,"");var domainPart="";if(!isLocal(hostname)&&domain&&domain!=="localhost"&&(hostname===domain||hostname.slice(-(domain.length+1))==="."+domain)){domainPart="; Domain=."+domain;}var secure=window.location.protocol==="https:"?"; Secure":"";document.cookie=key+"="+value+"; Path=/; Max-Age="+maxAge+"; SameSite=Lax"+domainPart+secure;}catch(error){}};if(!cookieTheme)writeCookie(theme);try{window.localStorage.setItem(key,theme);}catch(error){}})();`;
}

function createThemeReconciliationScript(): string {
  return `(function(){if(typeof window.addEventListener!=="function")return;var key="hypercli_color_theme";var legacyKey="hypercli_theme";var normalize=function(value){return value==="dark"||value==="light"?value:null;};var normalizeLegacy=function(value){return value==="default"||value==="green"?"dark":normalize(value);};var readCookie=function(name,normalizer){var cookies;try{cookies=document.cookie;}catch(error){return null;}var parts=cookies.split(";");for(var index=0;index<parts.length;index++){var part=parts[index];var separator=part.indexOf("=");if(separator<0||part.slice(0,separator).trim()!==name)continue;try{var theme=normalizer(decodeURIComponent(part.slice(separator+1).trim()));if(theme)return theme;}catch(error){}}return null;};var readStorage=function(name,normalizer){try{return normalizer(window.localStorage.getItem(name));}catch(error){return null;}};var apply=function(theme){var root=document.documentElement;root.setAttribute("data-theme",theme);root.style.colorScheme=theme;if(document.body)document.body.setAttribute("data-theme",theme);try{window.localStorage.setItem(key,theme);}catch(error){}};var synchronize=function(){var theme=readCookie(key,normalize)||readCookie(legacyKey,normalizeLegacy)||readStorage(key,normalize)||readStorage(legacyKey,normalizeLegacy)||"dark";apply(theme);};window.addEventListener("focus",synchronize);window.addEventListener("pageshow",synchronize);window.addEventListener("storage",function(event){if(event.key===key||event.key===legacyKey)synchronize();});if(typeof document.addEventListener==="function")document.addEventListener("visibilitychange",function(){if(document.visibilityState==="visible")synchronize();});})();`;
}

export function ThemeScript({ nonce }: ThemeScriptProps) {
  const script = createThemeScript(process.env.NEXT_PUBLIC_COOKIE_DOMAIN || "") + createThemeReconciliationScript();
  return (
    <script
      id="hypercli-theme-script"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
