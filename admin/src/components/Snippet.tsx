import { CopyButton } from "./ui";

export function snippetFor(key: string, host = location.origin): string {
  return `<script async src="${host}/hanu.js" data-token="${key}"></script>`;
}

export function Snippet({ publicKey }: { publicKey: string }) {
  const code = snippetFor(publicKey);
  return (
    <div className="rounded-xl border hairline bg-s2 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[12px] font-medium text-t2">Paste before <code className="font-mono">&lt;/head&gt;</code> on every page</div>
        <CopyButton text={code} label="Copy snippet" />
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-s1 p-3 font-mono text-[12.5px] leading-relaxed text-t1">{code}</pre>
    </div>
  );
}
