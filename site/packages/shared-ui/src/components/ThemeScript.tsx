const THEME_SCRIPT = `(function(){try{var key="hypercli_theme";var fallback="default";var normalize=function(value){if(value==="default"||value==="dark"||value==="light")return value;if(value==="green")return fallback;return null;};var cookieMatch=document.cookie.match(new RegExp("(^| )"+key+"=([^;]+)"));var theme=cookieMatch?normalize(decodeURIComponent(cookieMatch[2])):null;if(!theme&&window.localStorage){theme=normalize(window.localStorage.getItem(key));}document.documentElement.setAttribute("data-theme",theme||fallback);}catch(error){document.documentElement.setAttribute("data-theme","default");}})();`;

export function ThemeScript() {
  return <script id="hypercli-theme-script" dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
