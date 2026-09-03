export interface TranslationRequest {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  signal?: AbortSignal;
}

export interface TranslationResponse {
  translatedText: string;
  detectedLanguage?: string;
  provider: string;
}

export interface TranslationProvider {
  id: string;
  label: string;
  translate(request: TranslationRequest): Promise<TranslationResponse>;
}

export interface LibreTranslateAdapterOptions {
  endpoint: string;
  apiKey?: string;
  format?: "text" | "html";
}

interface LibreTranslateSuccessResponse {
  translatedText?: string;
  detectedLanguage?: {
    language?: string;
  };
  error?: string;
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

export class LibreTranslateAdapter implements TranslationProvider {
  readonly id = "libretranslate";
  readonly label = "LibreTranslate";

  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly format: "text" | "html";

  constructor({
    endpoint,
    apiKey,
    format = "text",
  }: LibreTranslateAdapterOptions) {
    this.endpoint = normalizeEndpoint(endpoint);
    this.apiKey = apiKey;
    this.format = format;
  }

  async translate({
    text,
    sourceLanguage,
    targetLanguage,
    signal,
  }: TranslationRequest): Promise<TranslationResponse> {
    const response = await fetch(`${this.endpoint}/translate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: text,
        source: sourceLanguage,
        target: targetLanguage,
        format: this.format,
        api_key: this.apiKey,
      }),
      signal,
    });

    const payload = (await response.json()) as LibreTranslateSuccessResponse;

    if (!response.ok) {
      throw new Error(payload.error || "LibreTranslate request failed.");
    }

    if (!payload.translatedText) {
      throw new Error("LibreTranslate returned no translated text.");
    }

    return {
      translatedText: payload.translatedText,
      detectedLanguage: payload.detectedLanguage?.language,
      provider: this.id,
    };
  }
}

export function createLibreTranslateAdapter(
  options: LibreTranslateAdapterOptions,
): TranslationProvider {
  return new LibreTranslateAdapter(options);
}
