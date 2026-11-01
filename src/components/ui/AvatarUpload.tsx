import { t } from "@lingui/core/macro";
import type React from "react";
import { useRef, useState } from "react";
import { FaSpinner, FaTimes, FaUpload } from "react-icons/fa";
import { waitForAuthToken } from "../../lib/authToken";
import ircClient from "../../lib/ircClient";
import useStore from "../../store";
import { TextInput } from "./TextInput";

type UploadFailure =
  | "notImage"
  | "tooLarge"
  | "forbidden"
  | "unreachable"
  | "failed";

class AvatarUploadError extends Error {
  constructor(readonly failure: UploadFailure) {
    super(failure);
    this.name = "AvatarUploadError";
  }
}

function failureText(failure: UploadFailure, isChannel: boolean): string {
  switch (failure) {
    case "notImage":
      return t`Choose an image file`;
    case "tooLarge":
      return t`Choose an image under 5 MB`;
    case "forbidden":
      return isChannel
        ? t`Only channel ops can change this`
        : t`Log in to upload an avatar`;
    case "unreachable":
      return t`Can't reach the upload server. Try again`;
    case "failed":
      return t`Upload failed. Try again`;
  }
}

function failureFromStatus(status: number): UploadFailure {
  if (status === 401 || status === 403) return "forbidden";
  if (status === 413) return "tooLarge";
  return "failed";
}

interface AvatarUploadProps {
  currentAvatarUrl?: string;
  onAvatarUrlChange: (url: string) => void;
  serverId: string;
  channelName?: string; // For channel avatars
  className?: string;
}

const AvatarUpload: React.FC<AvatarUploadProps> = ({
  currentAvatarUrl,
  onAvatarUrlChange,
  serverId,
  channelName,
  className = "",
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<UploadFailure | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const { servers } = useStore();

  const server = servers.find((s) => s.id === serverId);
  const filehostUrl = server?.filehost;

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setUploadError("notImage");
      return;
    }

    // Validate file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("tooLarge");
      return;
    }

    setUploadError(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPreviewUrl(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Start upload
    uploadAvatar(file);
  };

  const uploadAvatar = async (file: File) => {
    if (!filehostUrl || !serverId) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      // draft/authtoken: clear any cached token and ask for a fresh one.
      // The server scopes per-token to (account, channel) so we always
      // re-mint when target changes.
      useStore.setState((state) => ({
        servers: state.servers.map((server) =>
          server.id === serverId
            ? {
                ...server,
                authToken: undefined,
                authTokenUrl: undefined,
                authTokenService: undefined,
              }
            : server,
        ),
      }));

      const scope = channelName ? `channel:${channelName}` : undefined;
      ircClient.requestToken(serverId, "filehost", scope);
      const authToken = await waitForAuthToken(serverId, "filehost");
      if (!authToken) throw new AvatarUploadError("failed");
      const refreshed = useStore
        .getState()
        .servers.find((s) => s.id === serverId);
      const baseUrl = refreshed?.authTokenUrl || refreshed?.filehost || "";

      const formData = new FormData();
      formData.append("image", file);

      const endpoint = channelName
        ? `/upload/avatar/channel/${encodeURIComponent(channelName)}`
        : "/upload/avatar/user";

      const uploadUrl = `${baseUrl}${endpoint}`;

      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      }).catch((error: unknown) => {
        console.error("Avatar upload could not reach the server:", error);
        throw new AvatarUploadError("unreachable");
      });

      if (!response.ok) {
        console.error(
          "Avatar upload refused:",
          response.status,
          await response.text(),
        );
        throw new AvatarUploadError(failureFromStatus(response.status));
      }

      const data = await response.json();
      if (!data.saved_url) throw new AvatarUploadError("failed");
      onAvatarUrlChange(`${baseUrl}${data.saved_url}`);
      setPreviewUrl(null);
    } catch (error) {
      if (!(error instanceof AvatarUploadError))
        console.error("Avatar upload failed:", error);
      setUploadError(
        error instanceof AvatarUploadError ? error.failure : "failed",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const clearAvatar = () => {
    setPreviewUrl(null);
    setUploadError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onAvatarUrlChange("");
  };

  if (!filehostUrl) {
    // Fallback to URL input if no filehost
    return (
      <TextInput
        type="url"
        value={currentAvatarUrl || ""}
        onChange={(e) => onAvatarUrlChange(e.target.value)}
        placeholder={t`https://example.com/avatar.jpg`}
        className={`w-full bg-discord-dark-400 text-discord-text-normal rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-discord-primary ${className}`}
      />
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleUploadClick}
          disabled={isUploading}
          className="flex items-center gap-2 px-3 py-2 button-primary rounded disabled:cursor-not-allowed"
        >
          {isUploading ? <FaSpinner className="animate-spin" /> : <FaUpload />}
          {isUploading ? t`Uploading...` : t`Upload Avatar`}
        </button>

        {(previewUrl || currentAvatarUrl) && (
          <button
            type="button"
            onClick={clearAvatar}
            className="flex items-center gap-2 px-3 py-2 bg-discord-dark-300 hover:bg-discord-dark-200 text-white rounded"
          >
            <FaTimes />
            {t`Clear`}
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileSelect}
        className="hidden"
      />

      {uploadError && (
        <p role="alert" className="text-red-400 text-sm">
          {failureText(uploadError, !!channelName)}
        </p>
      )}

      {(previewUrl || currentAvatarUrl) && (
        <div className="flex items-center gap-3">
          <img
            src={previewUrl || currentAvatarUrl}
            alt={t`Avatar preview`}
            className="w-16 h-16 rounded-full object-cover border-2 border-discord-dark-300"
            onError={(e) => {
              e.currentTarget.style.display = "none";
            }}
          />
          <div className="text-sm text-discord-text-muted">
            {previewUrl ? t`Preview (not yet uploaded)` : t`Current avatar`}
          </div>
        </div>
      )}
    </div>
  );
};

export default AvatarUpload;
