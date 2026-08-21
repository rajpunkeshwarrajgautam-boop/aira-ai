"use client";

import { Check, ExternalLink, Loader2, Share2 } from "lucide-react";
import { useCallback, useState } from "react";

import { createShareLink } from "@/src/v2/compat/account-api";

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export function ShareAnswerButton({
  conversationId,
  messageId,
}: {
  readonly conversationId: string;
  readonly messageId: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const share = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const resolved = url ?? (await createShareLink({ conversationId, messageId }));
      setUrl(resolved);
      const didCopy = await copyText(resolved);
      setCopied(didCopy);
      if (!didCopy) setError("Link created. Open it to copy manually.");
      if (didCopy) window.setTimeout(() => setCopied(false), 1800);
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "Share link could not be created.");
    } finally {
      setLoading(false);
    }
  }, [conversationId, loading, messageId, url]);

  return (
    <div className="v2-share-control">
      <button type="button" onClick={() => void share()} disabled={loading}>
        {loading ? <Loader2 className="spin" aria-hidden /> : copied ? <Check aria-hidden /> : <Share2 aria-hidden />}
        {loading ? "Sharing…" : copied ? "Copied" : url ? "Copy link" : "Share"}
      </button>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label="Open shared answer">
          <ExternalLink aria-hidden />
        </a>
      ) : null}
      {error ? <span role="status">{error}</span> : null}
    </div>
  );
}
