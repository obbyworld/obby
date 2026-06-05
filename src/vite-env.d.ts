/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
declare const __APP_NAME__: string;
declare const __APP_DESCRIPTION__: string;
declare const __DEFAULT_IRC_SERVER__: string;
declare const __DEFAULT_IRC_SERVER_NAME__: string;
declare const __DEFAULT_IRC_CHANNELS__: string[];
declare const __HIDE_SERVER_LIST__: boolean;
declare const __DEFAULT_OAUTH_PROVIDER_LABEL__: string | undefined;
declare const __DEFAULT_OAUTH_ISSUER__: string | undefined;
declare const __DEFAULT_OAUTH_CLIENT_ID__: string | undefined;
declare const __DEFAULT_OAUTH_SCOPES__: string | undefined;
declare const __DEFAULT_OAUTH_REDIRECT_URI__: string | undefined;
declare const __DEFAULT_OAUTH_TOKEN_KIND__: string | undefined;
declare const __DEFAULT_OAUTH_SERVER_PROVIDER__: string | undefined;
declare const __DEFAULT_OAUTH_AUTHORIZE_URL__: string | undefined;
declare const __DEFAULT_OAUTH_TOKEN_URL__: string | undefined;
declare const __BACKEND_URL__: string;
declare const __TRUSTED_MEDIA_URLS__: string[];

// Build-time slimmed emoji-datasource (see emojiSlimPlugin in vite.config.ts).
declare module "virtual:emoji-slim" {
  const data: { unified: string; short_names: string[]; category: string }[];
  export default data;
}
