import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type * as React from "react";
import { useRef, useState } from "react";
import { BaseModal } from "../../lib/modal/BaseModal";
import { TextInput } from "./TextInput";

interface GifSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectGif: (gifUrl: string) => void;
}

type GifProvider = "giphy" | "tenor";

interface Gif {
  id: string;
  url: string;
  previewUrl: string;
  title: string;
}

interface GiphyGif {
  id: string;
  images: {
    original: { url: string };
    fixed_height_small: { url: string };
  };
  title?: string;
}

interface TenorGif {
  id: string;
  media_formats: {
    gif: { url: string };
    tinygif: { url: string };
  };
  title?: string;
}

interface GifProviderInfo {
  label: string;
  apiKey: string | undefined;
  searchUrl: (query: string, apiKey: string) => string;
  toGifs: (response: { data?: GiphyGif[]; results?: TenorGif[] }) => Gif[];
}

const PROVIDERS: Record<GifProvider, GifProviderInfo> = {
  giphy: {
    label: "GIPHY",
    apiKey: import.meta.env.VITE_GIPHY_API_KEY,
    searchUrl: (query, apiKey) =>
      `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${query}&limit=20&rating=g`,
    toGifs: (response) =>
      (response.data ?? []).map((gif) => ({
        id: gif.id,
        url: gif.images.original.url,
        previewUrl: gif.images.fixed_height_small.url,
        title: gif.title || "GIF",
      })),
  },
  tenor: {
    label: "Tenor",
    apiKey: import.meta.env.VITE_TENOR_API_KEY,
    searchUrl: (query, apiKey) =>
      `https://tenor.googleapis.com/v2/search?q=${query}&key=${apiKey}&limit=20&contentfilter=medium`,
    toGifs: (response) =>
      (response.results ?? []).map((gif) => ({
        id: gif.id,
        url: gif.media_formats.gif.url,
        previewUrl: gif.media_formats.tinygif.url,
        title: gif.title || "GIF",
      })),
  },
};

export const gifProviders = (Object.keys(PROVIDERS) as GifProvider[]).filter(
  (provider) => PROVIDERS[provider].apiKey,
);

type GifSearch =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed" }
  | { status: "done"; gifs: Gif[] };

const GifResults: React.FC<{
  search: GifSearch;
  onPick: (gif: Gif) => void;
}> = ({ search, onPick }) => {
  if (search.status === "loading") {
    return (
      <p className="text-center text-discord-text-muted py-8">
        <Trans>Loading GIFs...</Trans>
      </p>
    );
  }
  if (search.status === "failed") {
    return (
      <p className="text-center text-discord-red py-8">
        <Trans>Could not load GIFs. Search again to retry.</Trans>
      </p>
    );
  }
  if (search.status === "idle") {
    return (
      <p className="text-center text-discord-text-muted py-8">
        <Trans>Search for GIFs to get started</Trans>
      </p>
    );
  }
  if (search.gifs.length === 0) {
    return (
      <p className="text-center text-discord-text-muted py-8">
        <Trans>No GIFs found. Try another search.</Trans>
      </p>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
      {search.gifs.map((gif) => (
        <button
          key={gif.id}
          type="button"
          className="rounded-lg overflow-hidden hover:ring-2 hover:ring-discord-primary transition-all"
          onClick={() => onPick(gif)}
        >
          <img
            src={gif.previewUrl}
            alt={gif.title}
            className="w-full h-32 object-cover"
          />
        </button>
      ))}
    </div>
  );
};

const GifSelector: React.FC<GifSelectorProps> = ({
  isOpen,
  onClose,
  onSelectGif,
}) => {
  const [activeProvider, setActiveProvider] = useState<GifProvider>(
    gifProviders[0] ?? "giphy",
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [search, setSearch] = useState<GifSearch>({ status: "idle" });
  const searchIdRef = useRef(0);

  function handleProviderChange(provider: GifProvider) {
    searchIdRef.current++;
    setActiveProvider(provider);
    setSearch({ status: "idle" });
    setSearchQuery("");
  }

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!searchQuery.trim()) return;
    const searchId = ++searchIdRef.current;
    const provider = PROVIDERS[activeProvider];
    setSearch({ status: "loading" });
    try {
      const response = await fetch(
        provider.searchUrl(
          encodeURIComponent(searchQuery),
          provider.apiKey ?? "",
        ),
      );
      if (!response.ok) throw new Error(`GIF search ${response.status}`);
      const gifs = provider.toGifs(await response.json());
      if (searchId === searchIdRef.current) setSearch({ status: "done", gifs });
    } catch (error) {
      console.error("GIF search failed:", error);
      if (searchId === searchIdRef.current) setSearch({ status: "failed" });
    }
  };

  const handleGifClick = (gif: Gif) => {
    onSelectGif(gif.url);
    onClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      maxWidth="2xl"
      title={<Trans>Send a GIF</Trans>}
    >
      {gifProviders.length > 1 && (
        <div className="p-4 border-b border-discord-dark-300 flex gap-2">
          {gifProviders.map((provider) => (
            <button
              key={provider}
              type="button"
              className={`px-4 py-2 rounded ${
                activeProvider === provider
                  ? "bg-discord-primary text-white"
                  : "bg-discord-dark-200 text-discord-text-muted hover:text-white"
              }`}
              onClick={() => handleProviderChange(provider)}
            >
              {PROVIDERS[provider].label}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={handleSearch}
        className="p-4 border-b border-discord-dark-300 flex gap-2"
      >
        <TextInput
          type="search"
          enterKeyHint="search"
          placeholder={t`Search GIFs...`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 bg-discord-dark-200 border border-discord-dark-300 rounded text-white placeholder-discord-text-muted focus:outline-none focus:border-discord-primary"
        />
        <button
          type="submit"
          disabled={search.status === "loading"}
          className="px-4 py-2 bg-discord-primary text-white rounded hover:bg-discord-primary/90 disabled:opacity-50"
        >
          {search.status === "loading" ? (
            <Trans>Searching...</Trans>
          ) : (
            <Trans>Search</Trans>
          )}
        </button>
      </form>

      <div className="p-4 max-h-96 overflow-y-auto">
        <GifResults search={search} onPick={handleGifClick} />
      </div>
    </BaseModal>
  );
};

export default GifSelector;
