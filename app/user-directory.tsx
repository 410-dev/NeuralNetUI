"use client";
import { ArrowDownAZ, ArrowUpAZ, Check, ChevronLeft, ChevronRight, ListChecks, Search, UserCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { UsagePlan, UserSummary } from "@/lib/types";
import { SelectMenu } from "./select-menu";
import { useModalFocus } from "@/lib/use-modal-focus";

export type PickedUser = Pick<UserSummary, "id" | "username" | "displayName">;
type Sort = "name" | "username" | "created" | "plan" | "role";

// One search, sort and page state shared by every administrator surface that lists accounts.
export function useUserDirectory({ withPlanFilter = false }: { withPlanFilter?: boolean } = {}) {
  const [query, setQuery] = useState(""), [search, setSearch] = useState(""), [sort, setSort] = useState<Sort>("name"), [dir, setDir] = useState<"asc" | "desc">("asc"), [planId, setPlanId] = useState("");
  const [page, setPage] = useState(1), [pageCount, setPageCount] = useState(1), [total, setTotal] = useState(0), [users, setUsers] = useState<UserSummary[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [version, setVersion] = useState(0);
  useEffect(() => { const timer = window.setTimeout(() => { setSearch(query.trim()); setPage(1); }, 220); return () => window.clearTimeout(timer); }, [query]);
  const params = (extra: Record<string, string> = {}) => new URLSearchParams({ q: search, sort, dir, ...(withPlanFilter && planId ? { planId } : {}), ...extra });
  useEffect(() => {
    const controller = new AbortController(); setLoading(true);
    fetch(`/api/users?${params({ page: String(page) })}`, { cache: "no-store", signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setUsers(body.users); setPageCount(body.pageCount); setTotal(body.total); if (body.page !== page) setPage(body.page); setError(""); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, sort, dir, planId, page, version]);
  async function everyMatch(): Promise<PickedUser[]> { const response = await fetch(`/api/users?${params({ all: "1" })}`, { cache: "no-store" }), body = await response.json(); if (!response.ok) throw new Error(body.error); return body.users; }
  return { query, setQuery, sort, setSort: (value: Sort) => { setSort(value); setPage(1); }, dir, setDir, planId, setPlanId: (value: string) => { setPlanId(value); setPage(1); }, page, setPage, pageCount, total, users, loading, error, reload: () => setVersion(value => value + 1), everyMatch };
}
type Directory = ReturnType<typeof useUserDirectory>;

export function roleLabel(role: string, ko: boolean) { return role === "superadmin" ? (ko ? "최고 관리자" : "Super admin") : role === "admin" ? (ko ? "관리자" : "Admin") : (ko ? "사용자" : "User"); }

export function UserDirectoryToolbar({ directory, ko, plans, sorts = ["name", "username", "created", "role"] }: { directory: Directory; ko: boolean; plans?: UsagePlan[]; sorts?: Sort[] }) {
  const sortLabels: Record<Sort, string> = { name: ko ? "표시 이름" : "Display name", username: ko ? "사용자 이름" : "Username", created: ko ? "가입일" : "Created", plan: ko ? "플랜" : "Plan", role: ko ? "권한" : "Role" };
  return <div className="user-directory-toolbar">
    <label className="user-search-field"><Search size={16}/><input data-autofocus value={directory.query} onChange={event => directory.setQuery(event.target.value)} placeholder={ko ? "사용자 이름, 표시 이름 또는 ID 검색" : "Search username, display name, or ID"} aria-label={ko ? "사용자 검색" : "Search users"}/>{directory.query && <button type="button" aria-label={ko ? "검색어 지우기" : "Clear search"} onClick={() => directory.setQuery("")}><X size={14}/></button>}</label>
    {plans && <SelectMenu label={ko ? "플랜 필터" : "Plan filter"} value={directory.planId} options={[{ value: "", label: ko ? "모든 플랜" : "All plans" }, ...plans.map(plan => ({ value: plan.id, label: plan.name }))]} onChange={directory.setPlanId}/>}
    <div className="user-directory-sort"><SelectMenu label={ko ? "정렬 기준" : "Sort by"} value={directory.sort} options={sorts.map(value => ({ value, label: sortLabels[value] }))} onChange={value => directory.setSort(value as Sort)}/><button type="button" className="icon-mark" title={directory.dir === "asc" ? (ko ? "오름차순" : "Ascending") : (ko ? "내림차순" : "Descending")} aria-label={directory.dir === "asc" ? (ko ? "오름차순, 눌러서 내림차순으로 변경" : "Ascending, switch to descending") : (ko ? "내림차순, 눌러서 오름차순으로 변경" : "Descending, switch to ascending")} onClick={() => directory.setDir(directory.dir === "asc" ? "desc" : "asc")}>{directory.dir === "asc" ? <ArrowDownAZ size={17}/> : <ArrowUpAZ size={17}/>}</button></div>
  </div>;
}

export function UserDirectoryPager({ directory, ko }: { directory: Directory; ko: boolean }) {
  return <div className="audit-pager" role="navigation" aria-label={ko ? "페이지" : "Pages"}><button type="button" aria-label={ko ? "이전 페이지" : "Previous page"} disabled={directory.page <= 1} onClick={() => directory.setPage(directory.page - 1)}><ChevronLeft size={16}/></button><span>{directory.page} / {directory.pageCount}<small>{ko ? `총 ${directory.total}명` : `${directory.total} total`}</small></span><button type="button" aria-label={ko ? "다음 페이지" : "Next page"} disabled={directory.page >= directory.pageCount} onClick={() => directory.setPage(directory.page + 1)}><ChevronRight size={16}/></button></div>;
}

export function UserDirectoryStatus({ directory, ko }: { directory: Directory; ko: boolean }) {
  if (directory.error) return <p className="settings-notice" role="alert">{directory.error}</p>;
  if (!directory.users.length) return directory.loading ? <div className="audit-loading" aria-live="polite">{ko ? "불러오는 중…" : "Loading…"}</div> : <p className="audit-empty">{ko ? "일치하는 사용자가 없습니다." : "No matching users."}</p>;
  return null;
}

function UserIdentity({ user, ko, detail }: { user: Pick<UserSummary, "displayName" | "username"> & { role?: string }; ko: boolean; detail?: string }) {
  return <><span className="avatar-mini" aria-hidden="true">{user.displayName.charAt(0).toUpperCase()}</span><span className="directory-user-name"><strong>{user.displayName}</strong><small>@{user.username}{user.role ? ` · ${roleLabel(user.role, ko)}` : ""}{detail ? ` · ${detail}` : ""}</small></span></>;
}

function SelectionBar({ ko, count, pageUsers, selected, onChange, directory, onNotice }: { ko: boolean; count: number; pageUsers: PickedUser[]; selected: Map<string, PickedUser>; onChange: (next: Map<string, PickedUser>) => void; directory: Directory; onNotice: (value: string) => void }) {
  const pageSelected = pageUsers.length > 0 && pageUsers.every(user => selected.has(user.id));
  const [busy, setBusy] = useState(false);
  function togglePage() { const next = new Map(selected); pageUsers.forEach(user => pageSelected ? next.delete(user.id) : next.set(user.id, { id: user.id, username: user.username, displayName: user.displayName })); onChange(next); }
  async function selectAll() { setBusy(true); try { const next = new Map(selected); (await directory.everyMatch()).forEach(user => next.set(user.id, user)); onChange(next); } catch (error) { onNotice(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  return <div className="directory-selection-bar"><span><b>{count}</b>{ko ? "명 선택됨" : " selected"}</span><div><button type="button" className="subtle-action" disabled={!pageUsers.length} onClick={togglePage}><ListChecks size={14}/>{pageSelected ? (ko ? "이 페이지 해제" : "Clear page") : (ko ? "이 페이지 선택" : "Select page")}</button><button type="button" className="subtle-action" disabled={busy || !directory.total} onClick={() => void selectAll()}><UserCheck size={14}/>{ko ? `검색 결과 전체 (${directory.total})` : `All results (${directory.total})`}</button><button type="button" className="subtle-action" disabled={!count} onClick={() => onChange(new Map())}><X size={14}/>{ko ? "선택 해제" : "Clear"}</button></div></div>;
}

function CheckMark({ selected }: { selected: boolean }) { return <span className={`circle-check ${selected ? "selected" : ""}`} aria-hidden="true">{selected && <Check size={15}/>}</span>; }

function DialogShell({ label, description, className, onClose, ko, children }: { label: string; description: string; className: string; onClose: () => void; ko: boolean; children: React.ReactNode }) {
  const ref = useModalFocus(onClose);
  return createPortal(<div ref={ref} tabIndex={-1} className="harness-modal-layer directory-layer" role="dialog" aria-modal="true" aria-label={label}><button className="settings-backdrop" tabIndex={-1} onClick={onClose} aria-label={ko ? "닫기" : "Close"}/><section className={`harness-dialog directory-dialog ${className}`}><header><div><h2>{label}</h2><p>{description}</p></div><button type="button" title={ko ? "닫기" : "Close"} aria-label={ko ? "닫기" : "Close"} onClick={onClose}><X size={20}/></button></header>{children}</section></div>, document.body);
}

export function PlanUsersDialog({ ko, plans, onClose, onChanged }: { ko: boolean; plans: UsagePlan[]; onClose: () => void; onChanged: () => void }) {
  const directory = useUserDirectory({ withPlanFilter: true });
  const [selected, setSelected] = useState<Map<string, PickedUser>>(new Map()), [bulkPlan, setBulkPlan] = useState(plans[0]?.id || ""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const planName = (id?: string) => plans.find(plan => plan.id === id)?.name || (ko ? "플랜 없음" : "No plan");
  async function assign(ids: string[], planId: string) {
    setBusy(true); setNotice(""); const failures: string[] = [];
    for (const id of ids) { const response = await fetch(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId }) }); if (!response.ok) { const body = await response.json().catch(() => ({})); failures.push(`${selected.get(id)?.username || directory.users.find(user => user.id === id)?.username || id}: ${body.error || response.status}`); } }
    setBusy(false); directory.reload(); onChanged();
    setNotice(failures.length ? (ko ? `${ids.length - failures.length}명 변경, ${failures.length}명 실패 — ${failures.slice(0, 3).join(", ")}` : `${ids.length - failures.length} updated, ${failures.length} failed — ${failures.slice(0, 3).join(", ")}`) : (ko ? `${ids.length}명의 플랜을 ${planName(planId)}(으)로 변경했습니다.` : `Moved ${ids.length} user(s) to ${planName(planId)}.`));
    if (!failures.length && ids.length > 1) setSelected(new Map());
  }
  function toggle(user: UserSummary) { const next = new Map(selected); if (next.has(user.id)) next.delete(user.id); else next.set(user.id, user); setSelected(next); }
  return <DialogShell ko={ko} onClose={onClose} className="plan-users-dialog" label={ko ? "사용자별 플랜" : "Plans by user"} description={ko ? "계정을 검색하고 플랜을 개별 또는 일괄로 변경합니다. 변경 즉시 플랜의 저장소와 휴지통 용량이 적용됩니다." : "Search accounts and change plans one by one or in bulk. The plan's storage and trash capacity apply immediately."}>
    <UserDirectoryToolbar directory={directory} ko={ko} plans={plans} sorts={["name", "username", "plan", "created", "role"]}/>
    <SelectionBar ko={ko} count={selected.size} pageUsers={directory.users} selected={selected} onChange={setSelected} directory={directory} onNotice={setNotice}/>
    {notice && <p className="settings-notice" role="status">{notice}</p>}
    <div className="directory-list">{directory.users.map(user => <div key={user.id} className={`directory-row ${selected.has(user.id) ? "selected" : ""}`}><button type="button" className="directory-row-main" role="checkbox" aria-checked={selected.has(user.id)} onClick={() => toggle(user)}><CheckMark selected={selected.has(user.id)}/><UserIdentity user={user} ko={ko}/></button><SelectMenu label={ko ? `${user.displayName}의 플랜` : `${user.displayName}'s plan`} value={user.planId || ""} disabled={busy} options={plans.map(plan => ({ value: plan.id, label: plan.name }))} placeholder={ko ? "플랜 없음" : "No plan"} onChange={value => void assign([user.id], value)}/></div>)}</div>
    <UserDirectoryStatus directory={directory} ko={ko}/>
    <UserDirectoryPager directory={directory} ko={ko}/>
    <footer className="directory-footer"><span>{ko ? "선택한 사용자를" : "Move selected users to"}</span><SelectMenu label={ko ? "일괄 적용할 플랜" : "Plan to apply"} value={bulkPlan} options={plans.map(plan => ({ value: plan.id, label: plan.name }))} onChange={setBulkPlan}/><button type="button" className="save-button" disabled={busy || !selected.size || !bulkPlan} onClick={() => void assign([...selected.keys()], bulkPlan)}><Check size={15}/>{ko ? `${selected.size}명에게 적용` : `Apply to ${selected.size}`}</button></footer>
  </DialogShell>;
}

export function UserPickerDialog({ ko, initial, onClose, onConfirm }: { ko: boolean; initial: Map<string, PickedUser>; onClose: () => void; onConfirm: (users: Map<string, PickedUser>) => void }) {
  const directory = useUserDirectory();
  const [selected, setSelected] = useState(() => new Map(initial)), [notice, setNotice] = useState("");
  function toggle(user: UserSummary) { const next = new Map(selected); if (next.has(user.id)) next.delete(user.id); else next.set(user.id, { id: user.id, username: user.username, displayName: user.displayName }); setSelected(next); }
  return <DialogShell ko={ko} onClose={onClose} className="user-picker-dialog" label={ko ? "리셋권 받을 사용자" : "Reset credit recipients"} description={ko ? "여러 사용자를 검색해 선택합니다. 선택은 페이지와 검색을 바꿔도 유지됩니다." : "Search and select several users. Selections persist across pages and searches."}>
    <UserDirectoryToolbar directory={directory} ko={ko}/>
    <SelectionBar ko={ko} count={selected.size} pageUsers={directory.users} selected={selected} onChange={setSelected} directory={directory} onNotice={setNotice}/>
    {notice && <p className="settings-notice" role="alert">{notice}</p>}
    <div className="directory-list">{directory.users.map(user => <div key={user.id} className={`directory-row ${selected.has(user.id) ? "selected" : ""}`}><button type="button" className="directory-row-main" role="checkbox" aria-checked={selected.has(user.id)} onClick={() => toggle(user)}><CheckMark selected={selected.has(user.id)}/><UserIdentity user={user} ko={ko} detail={new Date(user.createdAt).toLocaleDateString(ko ? "ko-KR" : "en-US")}/></button></div>)}</div>
    <UserDirectoryStatus directory={directory} ko={ko}/>
    <UserDirectoryPager directory={directory} ko={ko}/>
    <footer className="directory-footer"><button type="button" className="secondary-button" onClick={onClose}>{ko ? "취소" : "Cancel"}</button><button type="button" className="save-button" onClick={() => { onConfirm(selected); onClose(); }}><Check size={15}/>{ko ? `${selected.size}명 선택 완료` : `Use ${selected.size} selected`}</button></footer>
  </DialogShell>;
}
