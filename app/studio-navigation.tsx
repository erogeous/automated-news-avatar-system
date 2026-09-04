"use client";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function StudioNavigation() {
  const library = usePathname().startsWith("/library");
  const settings = usePathname().startsWith("/settings");
  const [tab, setTab] = useState("projects");
  useEffect(() => { const update = () => setTab(new URLSearchParams(location.search).get("tab") || "projects"); update(); window.addEventListener("popstate", update); return () => window.removeEventListener("popstate", update); }, []);
  return <aside className="studioNav">
    <a className="studioBrand" href="/"><span>點</span><div>點觀香港<small>NEWS PRODUCTION STUDIO</small></div></a>
    <div className="navGroupLabel">工作空间</div>
    <nav aria-label="工作台导航">
      <a href="/" aria-current={!library ? "page" : undefined}><span aria-hidden="true">◫</span>内容制作</a>
      <a href="/library?tab=projects" aria-current={library && tab === "projects" ? "page" : undefined} target={!library ? "_blank" : undefined} rel="noreferrer"><span aria-hidden="true">▤</span>历史项目{!library && <small>↗</small>}</a>
      <a href="/library?tab=downloads" aria-current={library && tab === "downloads" ? "page" : undefined} target={!library ? "_blank" : undefined} rel="noreferrer"><span aria-hidden="true">▧</span>素材库{!library && <small>↗</small>}</a>
      <a href="/library?tab=sops" aria-current={library && tab === "sops" ? "page" : undefined} target={!library ? "_blank" : undefined} rel="noreferrer"><span aria-hidden="true">≡</span>写稿规则{!library && <small>↗</small>}</a>
      <a href="/settings" aria-current={settings ? "page" : undefined}><span aria-hidden="true">⚙</span>API 配置</a>
    </nav>
    <div className="navFoot"><span className="localDot"/> 本地工作空间<p>新闻 · 声音 · 数字人<br/>在同一个工作台完成</p><small>资料保存在当前电脑</small></div>
  </aside>;
}
