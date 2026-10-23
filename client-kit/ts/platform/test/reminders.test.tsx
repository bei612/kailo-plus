import { act, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { TransportError } from "../src/transport";
import { ReminderHostProvider, RemindMeLaterProvider, useRemindLater, useReminderMutations, RemindersPanel, buildInboxListRows, parseReminderContent, parseNotBefore, type ReminderHost, type Reminder } from "../src/react/reminders";
import { isDue, groupReminders } from "../src/react/reminders/lib/reminderFilters";
import { parseCustomDateTime } from "../src/react/reminders/lib/timePresets";
import { render, click, button } from "./render";
import { MessageRowSurface, type TimelineMessage } from "../src/react/messages";
import { remindersQueryKey } from "../src/react/reminders/hooks";
import { AppSidebarPrimaryMenu } from "../src/react/sidebar/app-sidebar-primary-menu";
import { SidebarProvider } from "../src/react/sidebar/sidebar";
import { DEFAULT_SLOT_ALERTS_ENABLED, DEFAULT_SLOT_SOUNDS } from "../src/react/notifications/sound";
import { DEFAULT_COMPONENT_ALERTS_ENABLED } from "../src/react/notifications/component-alerts";
import { InboxListPane } from "../src/react/inbox-list-pane";
import { TooltipProvider } from "../src/react/sidebar/tooltip";
import { PlatformProvider } from "../src/react/context";
import { createBffClient } from "../src/client";

const notificationEffects=vi.hoisted(()=>({sound:vi.fn()}));
vi.mock("../src/react/notifications/sound",async original=>({
  ...await original<typeof import("../src/react/notifications/sound")>(),playNotificationSound:notificationEffects.sound,
}));

const pubkey="a".repeat(64),eventId="b".repeat(64),resultId="c".repeat(64);
const target={eventId,channelId:"12345678-1234-4234-8234-123456789012",preview:"original message",authorPubkey:pubkey};
const reminder=(id="one",time=1):Reminder=>({id,eventId,createdAt:0,notBefore:time,content:parseReminderContent(JSON.stringify({status:"pending",target}))!});
function host():ReminderHost {return {scopeKey:"tenant:server",pubkey,query:vi.fn().mockResolvedValue([]),publish:vi.fn().mockResolvedValue({eventId:resultId}),source:vi.fn().mockResolvedValue({authorLabel:"Author",avatarUrl:null,channel:{channelType:"public"},channelLabel:"original"}),navigate:vi.fn().mockResolvedValue(undefined)};}
function Cache({children}:{children:React.ReactNode}) {return <QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}})}>{children}</QueryClientProvider>;}
beforeAll(()=>{
  Object.defineProperty(window,"matchMedia",{configurable:true,value:vi.fn(()=>({
    matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn(),
    addListener:vi.fn(),removeListener:vi.fn(),
  }))});
});
beforeEach(()=>{localStorage.clear();setLocale("en");notificationEffects.sound.mockReset();});

it.each(["en", "zh-CN"] as const)("shares the original Inbox list actions, UNKNOWN and personal branches (%s)", async locale => {
  setLocale(locale);
  const h=host(), select=vi.fn(), markRead=vi.fn(), markUnread=vi.fn(), open=vi.fn(), selectReminder=vi.fn();
  const item={id:eventId,conversationId:"same-conversation",latestActivityAt:3,
    item:{id:eventId,channelId:"admitted-workspace",pubkey,content:"original body"},groupItems:[{id:eventId}]};
  const orphan={...reminder("orphan"),content:parseReminderContent(JSON.stringify({status:"pending",note:"personal reminder"}))!};
  vi.mocked(h.query).mockResolvedValue([reminder(),orphan]);
  const height=vi.spyOn(HTMLElement.prototype,"offsetHeight","get").mockImplementation(function(this:HTMLElement){return this.hasAttribute("data-index")?96:420;});
  const width=vi.spyOn(HTMLElement.prototype,"offsetWidth","get").mockReturnValue(800);
  const rect=vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement){return new DOMRect(0,0,800,this.offsetHeight);});
  vi.stubGlobal("ResizeObserver",class{observe(){}unobserve(){}disconnect(){}});
  function List() {
    const [filter,setFilter]=useState<"all"|"drafts"|"reminders">("all");
    const [pending,setPending]=useState(false),[admitted,setAdmitted]=useState(true);
    return <><button onClick={()=>setPending(true)}>pending read</button><button onClick={()=>setFilter("drafts")}>draft branch</button>
      <button onClick={()=>setFilter("reminders")}>reminder branch</button><button onClick={()=>setAdmitted(false)}>revoke</button>
      <InboxListPane items={admitted?[item]:[]} filter={filter} onFilterChange={value=>{if(value==="all"||value==="drafts"||value==="reminders")setFilter(value);}}
        unreadOnly={false} onUnreadOnlyChange={vi.fn()} activeDraftCount={1} selectedConversationId={item.conversationId}
        selectedReminderId="orphan" onSelectReminder={selectReminder} onSelect={select} isRead={()=>false}
        onMarkRead={markRead} onMarkUnread={markUnread} readPending={pending} onOpen={open}
        reopenState={()=>({pending:false,error:true,unknown:true})} sourceChannelId={()=>target.channelId}
        presentation={()=>({senderLabel:"Author",sender:"Author",avatar:null,preview:"original body",timestamp:"now",unreadCount:2,label:"Thread",channel:"actual"})}
        draftList={<p>original admitted draft list</p>} />
    </>;
  }
  try {
    const client=createBffClient({send:async()=>{throw new Error("No additional transport in list presentation");}});
    const root=await render(<PlatformProvider client={client} locale={locale}><Cache><TooltipProvider><ReminderHostProvider host={h}><RemindMeLaterProvider pubkey={pubkey}><List/></RemindMeLaterProvider></ReminderHostProvider></TooltipProvider></Cache></PlatformProvider>);
    await vi.waitFor(()=>expect(root.querySelector(`[data-testid="home-inbox-item-${eventId}"]`)).not.toBeNull());
    const row=root.querySelector<HTMLElement>(`[data-testid="home-inbox-item-${eventId}"]`)!;
    expect(row.getAttribute("aria-current")).toBe("true");
    await vi.waitFor(()=>expect(row.querySelector('[data-testid="home-inbox-reminder-due"]')).not.toBeNull());
    await click(row.querySelector<HTMLButtonElement>('button[aria-label]')!);
    expect(select).toHaveBeenCalledExactlyOnceWith(item);expect(markRead).toHaveBeenCalledExactlyOnceWith(item);
    const retry=row.querySelector<HTMLButtonElement>(`[data-testid="home-inbox-reopen-retry-${eventId}"]`);
    expect(retry).not.toBeNull();await click(retry!);expect(open).toHaveBeenCalledExactlyOnceWith(item);
    await act(async()=>row.dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,button:2})));
    const menu=[...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(entry=>entry.textContent===(locale==="en"?"Mark as read":"标为已读"));
    expect(menu).toBeDefined();await click(menu!);expect(markRead).toHaveBeenCalledTimes(2);
    await click(button(root,"pending read"));
    expect(row.querySelector<HTMLButtonElement>(`button[aria-label="${locale==="en"?"Mark as read":"标为已读"}"]`)?.disabled).toBe(true);
    await click(row.querySelector<HTMLButtonElement>('button[aria-label]')!);expect(markRead).toHaveBeenCalledTimes(2);
    await click(root.querySelector<HTMLElement>('[data-testid="home-all-reminders-orphan"]')!);
    expect(selectReminder).toHaveBeenCalledExactlyOnceWith("orphan");
    await click(button(root,"revoke"));expect(root.textContent).not.toContain("original body");
    await click(button(root,"draft branch"));expect(root.querySelector('[data-testid="home-inbox-drafts"]')?.textContent).toContain("original admitted draft list");
    expect(root.querySelector('[data-testid="home-inbox-list"]')).toBeNull();
    await click(button(root,"reminder branch"));expect(root.querySelector('[data-testid="home-inbox-reminders"]')).not.toBeNull();
    expect(root.textContent).not.toContain("original admitted draft list");
    expect(h.publish).not.toHaveBeenCalled();expect(markUnread).not.toHaveBeenCalled();
  } finally {height.mockRestore();width.mockRestore();rect.mockRestore();vi.unstubAllGlobals();}
});

function notifyingHost():ReminderHost {
  return {...host(),notifications:{
    settings:{desktopEnabled:true,homeBadgeEnabled:true,notifyWhileViewing:false,sounds:{...DEFAULT_SLOT_SOUNDS},
      slotAlertsEnabled:{...DEFAULT_SLOT_ALERTS_ENABLED},slotAlertsSnapshot:null,
      componentAlertsEnabled:{...DEFAULT_COMPONENT_ALERTS_ENABLED}},
    send:vi.fn().mockResolvedValue(true),requestAttention:vi.fn().mockResolvedValue(undefined),
  }};
}

describe("original author-encrypted reminder consumers",()=>{
  it.each(["en","zh-CN"] as const)("keeps original watermark, coalescing, muted no-backlog and success-only sound (%s)",async locale=>{
    setLocale(locale);vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
    const now=Math.floor(Date.now()/1000),h=notifyingHost();
    let rows=[reminder("past",now-1),reminder("next",now+45),reminder("second",now+50)];
    vi.mocked(h.query).mockImplementation(async()=>rows);
    try {
      await render(<Cache><ReminderHostProvider host={h}><RemindMeLaterProvider pubkey={pubkey}>{null}</RemindMeLaterProvider></ReminderHostProvider></Cache>);
      await act(async()=>{await vi.advanceTimersByTimeAsync(30_001);});
      expect(h.notifications!.send).not.toHaveBeenCalled();
      await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
      expect(h.source).toHaveBeenCalledTimes(2);
      expect(h.notifications!.send).toHaveBeenCalledWith({title:locale==="en"?"Reminder due":"提醒已到期",body:locale==="en"?"2 reminders are due":"2 条提醒已到期"});
      expect(notificationEffects.sound).toHaveBeenCalledWith("flutter");
      expect(h.notifications!.requestAttention).toHaveBeenCalledTimes(1);
      h.notifications!.settings.slotAlertsEnabled.needs_action=false;
      rows=[...rows,reminder("muted",now+70)];
      await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
      h.notifications!.settings.slotAlertsEnabled.needs_action=true;
      await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
      expect(h.notifications!.send).toHaveBeenCalledTimes(1);
      rows=[...rows,reminder("denied",now+130)];
      vi.mocked(h.notifications!.send).mockResolvedValueOnce(false);
      await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
      expect(h.notifications!.send).toHaveBeenLastCalledWith({title:locale==="en"?"Reminder due in #original":"提醒已到期 · #original",body:target.preview});
      expect(notificationEffects.sound).toHaveBeenCalledTimes(1);
      expect(h.notifications!.requestAttention).toHaveBeenCalledTimes(1);
      rows=[...rows,reminder("unknown",now+160)];
      vi.mocked(h.notifications!.send).mockRejectedValueOnce(new TransportError("delivery unknown"));
      await act(async()=>{await vi.advanceTimersByTimeAsync(60_000);});
      expect(h.notifications!.send).toHaveBeenCalledTimes(3);
      expect(notificationEffects.sound).toHaveBeenCalledTimes(1);
      expect(h.publish).not.toHaveBeenCalled();
      const cursor=localStorage.getItem(`buzz:lastReminderCheck:${JSON.stringify([h.scopeKey,pubkey])}`)!;
      expect(Number(cursor)).toBe(now+210);expect(cursor).not.toContain(target.preview);
    } finally {vi.clearAllTimers();vi.useRealTimers();}
  });
  it.each(["query","source","identity"] as const)("never exposes a preview after %s loses current authority",async failure=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
    const now=Math.floor(Date.now()/1000),h=notifyingHost(),other={...notifyingHost(),scopeKey:"other:server",pubkey:"e".repeat(64)};
    vi.mocked(h.query).mockResolvedValue([reminder("due",now+1)]);
    localStorage.setItem(`buzz:lastReminderCheck:${JSON.stringify([h.scopeKey,pubkey])}`,String(now));
    let release!:()=>void;
    function Consumer(){const [current,setCurrent]=useState(h);return <ReminderHostProvider host={current}><RemindMeLaterProvider pubkey={current.pubkey}><button onClick={()=>setCurrent(other)}>Switch</button></RemindMeLaterProvider></ReminderHostProvider>;}
    try {
      const root=await render(<Cache><Consumer/></Cache>);
      await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
      if(failure==="query")vi.mocked(h.query).mockRejectedValue(new Error("revoked"));
      else if(failure==="source")vi.mocked(h.source).mockRejectedValue(new Error("revoked"));
      else vi.mocked(h.source).mockImplementation(()=>new Promise(resolve=>{release=()=>resolve({authorLabel:"Author",avatarUrl:null,channel:null,channelLabel:"original"});}));
      await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
      if(failure==="identity"){await click(button(root,"Switch"));await act(async()=>{release();});}
      expect(h.notifications!.send).not.toHaveBeenCalled();expect(other.notifications!.send).not.toHaveBeenCalled();
      expect(notificationEffects.sound).not.toHaveBeenCalled();expect(h.notifications!.requestAttention).not.toHaveBeenCalled();
    } finally {vi.clearAllTimers();vi.useRealTimers();}
  });
  it("updates the original Inbox badge when idle, cancelled, disabled or switched to another identity",async()=>{
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
    const h=host(),other={...host(),scopeKey:"other:client",pubkey:"d".repeat(64)};
    const pending=reminder("due-later",Math.floor(Date.now()/1000)+1);
    vi.mocked(h.query).mockResolvedValue([pending]);
    vi.mocked(h.publish).mockImplementationOnce(async()=>{
      vi.mocked(h.query).mockResolvedValue([{...pending,content:parseReminderContent(JSON.stringify({status:"cancelled",target}))!}]);
      return {eventId:resultId};
    });
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    function Cancel(){const actions=useReminderMutations(pubkey);return <button onClick={()=>actions.cancel.mutate(pending)}>Cancel due reminder</button>;}
    function Consumer(){
      const [enabled,setEnabled]=useState(true);
      const [current,setCurrent]=useState(h);
      return <ReminderHostProvider host={current}><RemindMeLaterProvider pubkey={current.pubkey}><SidebarProvider>
        <button onClick={()=>setEnabled(!enabled)}>Toggle badge</button>
        <button onClick={()=>setCurrent(other)}>Switch identity</button>
        {current===h?<Cancel/>:null}
        <AppSidebarPrimaryMenu homeBadgeEnabled={enabled} homeBadgeCount={enabled?2:0}
          onSelectHome={()=>{}} onSelectPlatformSection={()=>{}} selectedPlatformSection={null} selectedView="home"/>
      </SidebarProvider></RemindMeLaterProvider></ReminderHostProvider>;
    }
    try {
      const root=await render(<QueryClientProvider client={cache}><Consumer/></QueryClientProvider>);
      await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
      const badge=()=>root.querySelector('[data-testid="sidebar-home-count"]')?.textContent;
      expect(badge()).toBe("2");
      // The original background poll must re-evaluate unchanged query data.
      await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
      expect(h.query).toHaveBeenCalledTimes(2);
      expect(badge()).toBe("3");
      await click(button(root,"Toggle badge"));expect(badge()).toBeUndefined();
      await click(button(root,"Toggle badge"));expect(badge()).toBe("3");
      await click(button(root,"Cancel due reminder"));
      await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
      expect(h.publish).toHaveBeenCalledWith({operation:"CANCEL",eventId},expect.any(String),false,expect.any(Object));
      expect(badge()).toBe("2");
      await act(async()=>{cache.setQueryData(remindersQueryKey(h.scopeKey,pubkey),Array.from({length:100},(_,i)=>reminder(String(i))));await vi.advanceTimersByTimeAsync(1);});
      expect(badge()).toBe("99");
      let finishOldRead!:(rows:Reminder[])=>void;
      vi.mocked(h.query).mockImplementationOnce(()=>new Promise(resolve=>{finishOldRead=resolve;}));
      await act(async()=>{void cache.invalidateQueries({queryKey:remindersQueryKey(h.scopeKey,pubkey)});});
      await click(button(root,"Switch identity"));
      await act(async()=>{finishOldRead([pending]);});
      await act(async()=>{await vi.advanceTimersByTimeAsync(1);});
      expect(badge()).toBe("2");
      const oldCalls=vi.mocked(h.query).mock.calls.length;
      await act(async()=>{await vi.advanceTimersByTimeAsync(30_000);});
      expect(h.query).toHaveBeenCalledTimes(oldCalls);
      expect(other.query).toHaveBeenCalledTimes(2);
      expect(badge()).toBe("2");
      expect(h.publish).toHaveBeenCalledTimes(1);expect(other.publish).not.toHaveBeenCalled();
    } finally {vi.clearAllTimers();vi.useRealTimers();}
  });
  it("clears due counts when the existing authorized query is revoked",async()=>{
    const h=host();vi.mocked(h.query).mockResolvedValueOnce([reminder()]).mockRejectedValue(new Error("revoked"));
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const root=await render(<QueryClientProvider client={cache}><ReminderHostProvider host={h}><RemindMeLaterProvider pubkey={pubkey}>
      <SidebarProvider><AppSidebarPrimaryMenu homeBadgeEnabled homeBadgeCount={0} onSelectHome={()=>{}}
        onSelectPlatformSection={()=>{}} selectedPlatformSection={null} selectedView="home"/></SidebarProvider>
    </RemindMeLaterProvider></ReminderHostProvider></QueryClientProvider>);
    await vi.waitFor(()=>expect(root.querySelector('[data-testid="sidebar-home-count"]')?.textContent).toBe("1"));
    await act(async()=>{await cache.invalidateQueries({queryKey:remindersQueryKey(h.scopeKey,pubkey)});});
    await vi.waitFor(()=>expect(root.querySelector('[data-testid="sidebar-home-count"]')).toBeNull());
    expect(cache.getQueryState(remindersQueryKey(h.scopeKey,pubkey))?.status).toBe("error");
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("keeps original channel reminder tint reactive to pending, completed and cancelled heads",async()=>{
    const h=host();
    const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
    const key=remindersQueryKey(h.scopeKey,pubkey);
    const message:TimelineMessage={id:eventId,pubkey,author:"Author",body:target.preview,createdAt:0,depth:0,time:"",tags:[]};
    const root=await render(<QueryClientProvider client={cache}><ReminderHostProvider host={h}><RemindMeLaterProvider pubkey={pubkey}>
      <MessageRowSurface message={message} renderBody={()=>message.body}/>
      <MessageRowSurface message={{...message,id:"unrelated"}} renderBody={()=>message.body}/>
    </RemindMeLaterProvider></ReminderHostProvider></QueryClientProvider>);
    await vi.waitFor(()=>expect(cache.getQueryState(key)?.status).toBe("success"));
    const rows=root.querySelectorAll('[data-testid="message-row"]');
    expect(rows[0]!.classList.contains("bg-blue-500/10")).toBe(false);
    for(const status of ["pending","done","pending","cancelled"] as const) {
      await act(async()=>{cache.setQueryData(key,[{...reminder(),content:{...reminder().content,status}}]);});
      await vi.waitFor(()=>expect(rows[0]!.classList.contains("bg-blue-500/10")).toBe(status==="pending"));
      expect(rows[1]!.classList.contains("bg-blue-500/10")).toBe(false);
    }
    const outside=await render(<MessageRowSurface message={message} renderBody={()=>message.body}/>);
    expect(outside.querySelector('[data-testid="message-row"]')!.classList.contains("bg-blue-500/10")).toBe(false);
    expect(h.publish).not.toHaveBeenCalled();
  });
  it("keeps original canonical not_before and malformed plaintext behavior",()=>{
    for(const raw of ["01","-1","+1"," 1","1.0",String(Number.MAX_SAFE_INTEGER+1)])expect(parseNotBefore(raw)).toBeUndefined();
    expect(parseNotBefore("0")).toBe(0);
    expect(parseReminderContent('{"status":"pending","note":"personal"}')?.note).toBe("personal");
    for(const text of ['[]','{"status":"pending"}','{"status":"unknown","note":"x"}','{"status":"pending","target":{}}'])expect(parseReminderContent(text)).toBeNull();
    expect(parseCustomDateTime("2000-01-01","09:00")).toBeNull();
  });
  it("merges due reminders into original grouped rows without duplicating their messages",()=>{
    const one=reminder(),orphan={...reminder("orphan",3),content:{...reminder().content,target:{...target,eventId:"d".repeat(64)}}};
    const item={id:eventId,item:{id:eventId},groupItems:[{id:eventId}],conversationId:"same-thread",latestActivityAt:0};
    const rows=buildInboxListRows({items:[item],reminders:[one,orphan]});
    expect(rows.map(row=>row.kind)).toEqual(["reminder","inbox"]);
    expect(rows[1]).toMatchObject({item,dueReminder:one,sortAt:1});
    expect(isDue(one,1)).toBe(true);expect(isDue(one,0)).toBe(false);
    expect(groupReminders([one]).flatMap(group=>group.reminders)).toEqual([one]);
  });
  it.each(["en","zh-CN"] as const)("uses the original dialog and preset to invoke the actual typed host (%s)",async locale=>{
    setLocale(locale);const h=host();
    function Trigger(){const reminders=useRemindLater();return <button onClick={()=>reminders.openReminder(target)}>Open original</button>;}
    const root=await render(<Cache><ReminderHostProvider host={h}><RemindMeLaterProvider pubkey={pubkey}><Trigger/></RemindMeLaterProvider></ReminderHostProvider></Cache>);
    await click(button(root,"Open original"));
    const preset=[...document.querySelectorAll("button")].find(b=>b.textContent===(locale==="en"?"In 30 minutes":"30 分钟后"))!;
    await click(preset);
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect(vi.mocked(h.publish).mock.calls[0]?.[0]).toEqual({operation:"CREATE",channelId:target.channelId,sourceEventId:eventId,notBefore:expect.any(Number)});
    expect(vi.mocked(h.publish).mock.calls[0]?.[2]).toBe(false);
  });
  it("retains only the same intent and original event reference after UNKNOWN/remount",async()=>{
    const h=host();let mutations!:ReturnType<typeof useReminderMutations>;
    function Consumer(){mutations=useReminderMutations(pubkey);return null;}
    vi.mocked(h.publish).mockImplementationOnce(async(_request,_key,_observe,observation)=>{observation.onPrepared(resultId);throw new TransportError("lost acknowledgement");});
    await render(<Cache><ReminderHostProvider host={h}><Consumer/></ReminderHostProvider></Cache>);
    await act(async()=>{await expect(mutations.create.mutateAsync({target,notBefore:1,note:"private note"})).rejects.toThrow("lost acknowledgement");});
    const stored=[...Array(localStorage.length)].map((_,i)=>localStorage.getItem(localStorage.key(i)!)).join();
    expect(stored).toContain(resultId);expect(stored).not.toContain("private note");expect(stored).not.toContain(target.preview);
    const key=vi.mocked(h.publish).mock.calls[0]![1];
    await render(<Cache><ReminderHostProvider host={h}><Consumer/></ReminderHostProvider></Cache>);
    await act(async()=>{await expect(mutations.create.mutateAsync({target,notBefore:2,note:"changed note"})).rejects.toThrow("outcome unknown");});
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect([...Array(localStorage.length)].map((_,i)=>localStorage.getItem(localStorage.key(i)!)).join()).toBe(stored);
    await act(async()=>{await mutations.create.mutateAsync({target,notBefore:1,note:"private note"});});
    expect(vi.mocked(h.publish).mock.calls[1]?.[1]).toBe(key);
    expect(vi.mocked(h.publish).mock.calls[1]?.[2]).toBe(true);
    expect(vi.mocked(h.publish).mock.calls[1]?.[3].eventId).toBe(resultId);
    expect([...Array(localStorage.length)].map((_,i)=>localStorage.key(i)).some(key=>key?.includes("reminder-publication"))).toBe(false);
  });
  it("does not report a different operation or an old unbound recovery slot as success",async()=>{
    const h=host();let mutations!:ReturnType<typeof useReminderMutations>;
    function Consumer(){mutations=useReminderMutations(pubkey);return null;}
    vi.mocked(h.publish).mockImplementationOnce(async(_request,_key,_observe,observation)=>{observation.onPrepared(resultId);throw new TransportError("lost acknowledgement");});
    await render(<Cache><ReminderHostProvider host={h}><Consumer/></ReminderHostProvider></Cache>);
    await act(async()=>{await expect(mutations.snooze.mutateAsync({reminder:reminder(),notBefore:10})).rejects.toThrow("lost acknowledgement");});
    const slot=[...Array(localStorage.length)].map((_,i)=>localStorage.key(i)!).find(key=>key.includes("reminder-publication"))!;
    const stored=localStorage.getItem(slot)!;
    await act(async()=>{await expect(mutations.cancel.mutateAsync(reminder())).rejects.toThrow("outcome unknown");});
    expect(h.publish).toHaveBeenCalledTimes(1);expect(localStorage.getItem(slot)).toBe(stored);
    const {digest:_,...old}=JSON.parse(stored);localStorage.setItem(slot,JSON.stringify(old));
    await act(async()=>{await expect(mutations.snooze.mutateAsync({reminder:reminder(),notBefore:10})).rejects.toThrow("outcome unknown");});
    expect(h.publish).toHaveBeenCalledTimes(1);expect(localStorage.getItem(slot)).toBe(JSON.stringify(old));
  });
  it("keeps complete, snooze and cancel on the original head rather than copying plaintext",async()=>{
    const h=host();let mutations!:ReturnType<typeof useReminderMutations>;
    function Consumer(){mutations=useReminderMutations(pubkey);return null;}
    await render(<Cache><ReminderHostProvider host={h}><Consumer/></ReminderHostProvider></Cache>);
    await act(async()=>{await mutations.complete.mutateAsync(reminder());await mutations.snooze.mutateAsync({reminder:reminder(),notBefore:10});await mutations.cancel.mutateAsync(reminder());});
    expect(vi.mocked(h.publish).mock.calls.map(call=>call[0])).toEqual([{operation:"COMPLETE",eventId},{operation:"SNOOZE",eventId,notBefore:10},{operation:"CANCEL",eventId}]);
  });
  it("does not present a failed authorized read as No reminders",async()=>{
    const h=host();vi.mocked(h.query).mockRejectedValue(new Error("revoked"));
    const root=await render(<Cache><ReminderHostProvider host={h}><RemindersPanel pubkey={pubkey}/></ReminderHostProvider></Cache>);
    await vi.waitFor(()=>expect(root.querySelector('[role="status"]')).not.toBeNull());
    expect(root.textContent).not.toContain("No reminders");
  });
});
