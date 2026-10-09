"use client";
import { useEffect, useRef, useState } from "react";

const DRAFT_KEY = "news-avatar:current-draft-v1";

export async function libraryRequest(url: string, options?: RequestInit) {
  const response = await fetch("/api/library" + url, {
    ...options,
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json", ...options?.headers },
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); }
  catch {
    if (response.status === 401) throw new Error("登录状态已失效，请刷新页面后重新登录");
    throw new Error(`素材库接口 ${url} 返回了非 JSON 内容（HTTP ${response.status}）`);
  }
  if (!response.ok) throw new Error(data.error || "素材库操作失败");
  return data;
}

type Draft<T> = { id: string; revision: number; savedAt: number; snapshot: T };

function readDraft<T>(draftKey = DRAFT_KEY): Draft<T> | null {
  try { return JSON.parse(localStorage.getItem(draftKey) || "null"); }
  catch { return null; }
}

export function useProjectArchive<T extends { projectName: string; script: string; urls: string[]; audioSliceJobId: string }>(snapshot: T, restore: (snapshot: T) => void, draftKey = DRAFT_KEY) {
  const [ready, setReady] = useState(false), [status, setStatus] = useState("正在连接历史库…");
  const id = useRef(""), revision = useRef(0), latest = useRef(snapshot), restorer = useRef(restore), lastSaved = useRef(""), suspended = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  latest.current = snapshot;
  restorer.current = restore;
  const serialized = JSON.stringify(snapshot);

  function persistDraft() {
    if (!id.current) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ id: id.current, revision: revision.current, savedAt: Date.now(), snapshot: latest.current }));
    } catch {
      // Server persistence remains available if browser storage is unavailable.
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      const params = new URLSearchParams(location.search);
      const project = params.get("project"), version = params.get("revision"), copy = params.get("copy") === "1", forceNew = params.get("new") === "1";
      try {
        if (project && !/^[a-f0-9]{32}$/.test(project)) throw new Error("历史项目编号无效");
        if (project) {
          if (version && !/^\d+$/.test(version)) throw new Error("稿件版本编号无效");
          let record: { revision: number; snapshot: T } | null = null;
          try { record = await libraryRequest("/projects/" + project + (version ? "/versions/" + version : "")); }
          catch (error) {
            const draft = readDraft<T>(draftKey);
            if (!version && !copy && draft?.id === project && draft.snapshot) {
              id.current = project;
              revision.current = 0;
              latest.current = draft.snapshot;
              restorer.current(draft.snapshot);
              lastSaved.current = "";
              setStatus("已找回本地草稿，正在重新建立服务器历史…");
            } else throw error;
          }
          if (cancelled) return;
          if (record) {
            const isCreator = (record.snapshot as T & { projectType?: string }).projectType === "creator";
            if (isCreator !== (draftKey === "creator:current-draft-v1")) {
              throw new Error("个人项目已拆分，请在独立个人工作台打开");
            }
            id.current = copy ? crypto.randomUUID().replaceAll("-", "") : project;
            revision.current = copy ? 0 : record.revision;
            const restored = { ...record.snapshot, ...(copy ? { projectName: record.snapshot.projectName + "（副本）" } : {}) };
            latest.current = restored;
            restorer.current(restored);
            lastSaved.current = copy ? "" : JSON.stringify(restored);
            if (version && !copy) { suspended.current = true; setStatus("只读历史版本，请通过历史库复制后继续制作"); }
            else setStatus(copy ? "已载入副本，准备保存" : "已恢复历史项目");
          }
        } else if (!forceNew) {
          const draft = readDraft<T>(draftKey);
          if (draft && /^[a-f0-9]{32}$/.test(draft.id) && draft.snapshot) {
            id.current = draft.id;
            let serverRecord: { revision: number; updatedAt: number; snapshot: T } | null = null;
            try { serverRecord = await libraryRequest("/projects/" + draft.id); } catch {}
            if (cancelled) return;
            const useLocal = !serverRecord || draft.savedAt >= Number(serverRecord.updatedAt || 0);
            const restored = useLocal ? draft.snapshot : serverRecord!.snapshot;
            // A browser draft may remember a revision whose server record was
            // lost or moved. A missing server record must be recreated at 0.
            revision.current = serverRecord?.revision ?? 0;
            latest.current = restored;
            restorer.current(restored);
            lastSaved.current = useLocal ? "" : JSON.stringify(restored);
            setStatus(useLocal ? "已恢复未关闭的本地草稿，正在同步服务器…" : "已恢复最近项目");
          }
        }
        if (!id.current) {
          id.current = crypto.randomUUID().replaceAll("-", "");
          revision.current = 0;
          if (forceNew) localStorage.removeItem(draftKey);
          setStatus("内容将自动保存到历史库");
        }
        const url = new URL(location.href);
        url.searchParams.set("project", id.current);
        url.searchParams.delete("new");
        url.searchParams.delete("copy");
        if (!version) url.searchParams.delete("revision");
        history.replaceState(null, "", url);
        setReady(true);
      } catch (error) {
        if (!cancelled) { suspended.current = true; setStatus(error instanceof Error ? error.message : "恢复失败"); }
      }
    }
    void init();
    return () => { cancelled = true; };
  }, []);

  async function save() {
    if (!ready || suspended.current) return false;
    let success = true;
    queue.current = queue.current.catch(() => {}).then(async () => {
      const value = latest.current, text = JSON.stringify(value);
      persistDraft();
      if (!value.script && !value.urls.some(Boolean) && !value.audioSliceJobId) return;
      if (text === lastSaved.current) return;
      setStatus("正在保存…");
      const submit = (expectedRevision: number) => libraryRequest("/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id.current, expectedRevision, snapshot: value }) });
      const saved = (result: { revision: number }) => {
        revision.current = result.revision;
        lastSaved.current = text;
        persistDraft();
        setStatus("已自动保存 · 版本 " + result.revision);
      };
      try {
        saved(await submit(revision.current));
      } catch (error) {
        const message = error instanceof Error ? error.message : "保存失败";
        if (message.includes("其他页面")) {
          try {
            await libraryRequest("/projects/" + id.current);
            suspended.current = true;
            success = false;
            setStatus("保存暂停：服务器已有更新，请从历史项目重新打开");
          } catch {
            try {
              revision.current = 0;
              saved(await submit(0));
              success = true;
            } catch (retryError) {
              success = false;
              setStatus("保存失败：" + (retryError instanceof Error ? retryError.message : "重新建档失败"));
            }
          }
        } else {
          success = false;
          setStatus("保存失败：" + message);
        }
      }
    });
    await queue.current;
    return success;
  }

  const saver = useRef(save);
  saver.current = save;
  useEffect(() => {
    if (!ready) return;
    persistDraft();
    const timer = setTimeout(() => void saver.current(), 800);
    return () => clearTimeout(timer);
  }, [serialized, ready]);

  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => void saver.current(), 10_000);
    const preserve = () => { persistDraft(); void saver.current(); };
    const visibility = () => { if (document.visibilityState === "hidden") preserve(); };
    window.addEventListener("pagehide", preserve);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", preserve);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [ready]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      persistDraft();
      if (latest.current.script && JSON.stringify(latest.current) !== lastSaved.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return { ready, status, save };
}
