"use client";
import { FormEvent, useEffect, useState } from "react";
import "./style.css";

type PublicSetting = { configured?: boolean; value?: string };
type SettingsResponse = { localOnly: boolean; settings: Record<string, PublicSetting> };

const defaults = {
  OPENIAPI_BASE_URL: "https://openiapi.com/v1",
  OPENIAPI_API_KEY: "",
  LLM_MODEL: "gpt-5.4",
  TTS_MODEL: "speech-2.8-hd",
  HEYGEN_API_KEY: "",
  HEYGEN_API_BASE_URL: "https://api.heygen.com",
  HEYGEN_RESOLUTION: "1080p",
};

export default function ApiSettingsPage() {
  const [values, setValues] = useState(defaults);
  const [configured, setConfigured] = useState({ OPENIAPI_API_KEY: false, HEYGEN_API_KEY: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/apis", { cache: "no-store" }).then(async (response) => {
      const data = await response.json() as SettingsResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "无法读取 API 配置");
      setValues((current) => Object.fromEntries(Object.entries(current).map(([name, fallback]) =>
        [name, data.settings[name]?.value || fallback])) as typeof current);
      setConfigured({
        OPENIAPI_API_KEY: Boolean(data.settings.OPENIAPI_API_KEY?.configured),
        HEYGEN_API_KEY: Boolean(data.settings.HEYGEN_API_KEY?.configured),
      });
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "无法读取 API 配置"))
      .finally(() => setLoading(false));
  }, []);

  function field(name: keyof typeof values, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/settings/apis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
      const data = await response.json() as SettingsResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "API 配置保存失败");
      setConfigured({ OPENIAPI_API_KEY: Boolean(data.settings.OPENIAPI_API_KEY?.configured), HEYGEN_API_KEY: Boolean(data.settings.HEYGEN_API_KEY?.configured) });
      setValues((current) => ({ ...current, OPENIAPI_API_KEY: "", HEYGEN_API_KEY: "" }));
      setMessage("配置已保存并立即生效。密钥内容不会在页面中显示。");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "API 配置保存失败"); }
    finally { setSaving(false); }
  }

  return <main className="settingsPage">
    <header><span>SETTINGS</span><h1>API 配置</h1><p>为写稿、粤语配音和数字人任务绑定服务。密钥保存在当前电脑，不会显示在页面中。</p></header>
    {loading ? <div className="settingsNotice">正在读取配置…</div> : <form onSubmit={save}>
      <section>
        <div className="settingsSectionHead"><div><h2>OpenIAPI</h2><p>新闻写稿与 MiniMax 粤语配音</p></div><b className={configured.OPENIAPI_API_KEY ? "ready" : "missing"}>{configured.OPENIAPI_API_KEY ? "已配置" : "未配置"}</b></div>
        <label>API 地址<input value={values.OPENIAPI_BASE_URL} onChange={(e) => field("OPENIAPI_BASE_URL", e.target.value)} inputMode="url" /></label>
        <label>API Key<input type="password" autoComplete="new-password" value={values.OPENIAPI_API_KEY} onChange={(e) => field("OPENIAPI_API_KEY", e.target.value)} placeholder={configured.OPENIAPI_API_KEY ? "留空则保留现有密钥" : "粘贴 API Key"} /></label>
        <div className="settingsTwo"><label>写稿模型<input value={values.LLM_MODEL} onChange={(e) => field("LLM_MODEL", e.target.value)} /></label><label>配音模型<input value={values.TTS_MODEL} onChange={(e) => field("TTS_MODEL", e.target.value)} /></label></div>
      </section>
      <section>
        <div className="settingsSectionHead"><div><h2>HeyGen</h2><p>照片数字人与对口型视频</p></div><b className={configured.HEYGEN_API_KEY ? "ready" : "missing"}>{configured.HEYGEN_API_KEY ? "已配置" : "未配置"}</b></div>
        <label>API 地址<input value={values.HEYGEN_API_BASE_URL} onChange={(e) => field("HEYGEN_API_BASE_URL", e.target.value)} inputMode="url" /></label>
        <label>API Key<input type="password" autoComplete="new-password" value={values.HEYGEN_API_KEY} onChange={(e) => field("HEYGEN_API_KEY", e.target.value)} placeholder={configured.HEYGEN_API_KEY ? "留空则保留现有密钥" : "粘贴 API Key"} /></label>
        <label>输出清晰度<select value={values.HEYGEN_RESOLUTION} onChange={(e) => field("HEYGEN_RESOLUTION", e.target.value)}><option value="720p">720p</option><option value="1080p">1080p</option></select></label>
      </section>
      {message && <div className="settingsNotice success" role="status">{message}</div>}
      {error && <div className="settingsNotice error" role="alert">{error}</div>}
      <div className="settingsActions"><a href="/">返回工作台</a><button disabled={saving}>{saving ? "正在保存…" : "保存 API 配置"}</button></div>
    </form>}
    <aside><b>安全说明</b><p>当前配置入口只允许从本机访问。工作台部署到公网后，必须先增加管理员登录，才能开放修改 API 的权限。</p></aside>
  </main>;
}
