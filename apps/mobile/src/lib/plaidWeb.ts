type PlaidMetadata = { institution?: { id?: string; name?: string } };
type PlaidExitError = { display_message?: string };
type PlaidHandler = { open: () => void };
type PlaidGlobal = {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: PlaidMetadata) => void;
    onExit: (error: PlaidExitError | null, metadata: PlaidMetadata) => void;
    onEvent?: (eventName: string, metadata: PlaidMetadata) => void;
  }) => PlaidHandler;
};

declare global {
  interface Window { Plaid?: PlaidGlobal; }
}

let scriptPromise: Promise<void> | undefined;

function loadScript() {
  if (typeof window === "undefined") return Promise.reject(new Error("Plaid Link Web requires a browser."));
  if (window.Plaid) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load Plaid Link Web."));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function openPlaidLinkWeb(config: {
  token: string;
  onSuccess: (publicToken: string, metadata: PlaidMetadata) => void | Promise<void>;
  onExit: (error: PlaidExitError | null, metadata: PlaidMetadata) => void;
}) {
  await loadScript();
  if (!window.Plaid) throw new Error("Plaid Link Web is unavailable.");
  window.Plaid.create(config).open();
}

