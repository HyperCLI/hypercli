import Link from "next/link";
import { Hash, MessageCircle, Send, Slack, Terminal, Users } from "lucide-react";
import { HyperCLILogo } from "@hypercli/shared-ui";

const CHANNELS = [
  { name: "Slack", href: "/slack", icon: Slack, iconClassName: "text-[#A629A6]", left: "20%", top: "20%" },
  { name: "Teams", href: "/teams", icon: Users, iconClassName: "text-[#5B5FC7]", left: "80%", top: "20%" },
  { name: "Telegram", href: "/telegram", icon: Send, iconClassName: "text-[#229ED9]", left: "11.5%", top: "53%" },
  { name: "WhatsApp", href: "/whatsapp", icon: MessageCircle, iconClassName: "text-[#25D366]", left: "88.5%", top: "53%" },
  { name: "Discord", href: "/discord", icon: Hash, iconClassName: "text-[#5865F2]", left: "27%", top: "84.5%" },
  { name: "buzz", href: "/buzz", icon: Terminal, iconClassName: "text-[#9DB4FF]", left: "73%", top: "84.5%" },
];

export function HomeChannelNetwork() {
  return (
    <div className="home-channel-stage">
      <svg className="home-channel-lines" viewBox="0 0 640 330" aria-hidden="true">
        <line x1="320" y1="165" x2="128" y2="66" />
        <line x1="320" y1="165" x2="512" y2="66" />
        <line x1="320" y1="165" x2="74" y2="175" />
        <line x1="320" y1="165" x2="566" y2="175" />
        <line x1="320" y1="165" x2="172" y2="278" />
        <line x1="320" y1="165" x2="468" y2="278" />
      </svg>

      <div className="home-channel-hub">
        <div className="home-channel-core">
          <HyperCLILogo markOnly decorative className="h-14 w-14 max-[680px]:h-11 max-[680px]:w-11" />
        </div>
        <p className="home-channel-caption">
          your agent
          <br />
          <span>always on</span>
        </p>
      </div>

      {CHANNELS.map((channel) => (
        <Link
          key={channel.name}
          href={channel.href}
          className="home-channel-spoke"
          style={{ left: channel.left, top: channel.top }}
        >
          <span className="home-channel-chip">
            <channel.icon aria-hidden="true" className={`home-channel-icon ${channel.iconClassName}`} />
            {channel.name}
          </span>
        </Link>
      ))}
    </div>
  );
}
