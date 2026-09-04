import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import StudioNavigation from "./studio-navigation";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "新闻数字人工作台",
    description: "从新闻链接到 4 分钟数字人口播视频。",
    openGraph: { title: "新闻数字人工作台", description: "新闻 → 口播稿 → 配音 → 数字人", images: [image] },
    twitter: { card: "summary_large_image", title: "新闻数字人工作台", description: "新闻 → 口播稿 → 配音 → 数字人", images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><div className="studioFrame"><StudioNavigation/><div className="studioContent">{children}</div></div></body></html>;
}
