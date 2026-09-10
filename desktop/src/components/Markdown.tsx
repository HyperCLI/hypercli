import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

const urlTransform = (url: string) => (url.startsWith("data:image/") ? url : defaultUrlTransform(url));

export function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-markdown text-[13px] leading-[1.6]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={urlTransform}>{text}</ReactMarkdown>
    </div>
  );
}
