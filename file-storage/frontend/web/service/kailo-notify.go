package service

// DD-138(4), .design/07 §4.8.3: native event sources of the Kailo
// notification delivery (transport and rules: common/auth/native-oidc-notify.go).
// In Kailo mode, with the member directory client delivered, the events that
// used to feed the native bell / activity inbox / digest e-mail are mapped:
//
//   - activity inbox Share (broker/activity ProcessIdmBatch: READ/WRITE ACL on
//     a user's own role for a Cell or workspace) → SHARED to that user, actor
//     the sharer; path /ws-<slug> of that Cell/workspace. Kailo Workspace
//     membership (kailo-ws-*, directory sync) and public links are not shares.
//   - activity inbox UpdateComment (followers that can read the node,
//     HandleNodeChange; the author is never a recipient) → COMMENTED, except
//     for followers mentioned in the comment;
//   - a new node comment (chat ChatEvent) mentioning "@login" → MENTIONED to
//     each mentioned user who can read the node (read through the user's own
//     UUID router), never to the author;
//   - activity inbox Create/Update/Delete/Move of followed content (uploads
//     included: CREATE is skipped while the etag is temporary) →
//     CONTENT_UPDATED, aggregated per (recipient, parent folder) over 60 s, so
//     an upload of N files is one notification with a count;
//   - a user's own background task (compress, extract, copy/move outside the
//     recycle bin) that ran at least 30 s and finished → TASK_COMPLETED to
//     its owner (short tasks are visible while the user waits).
//
// Recipients/actors are mapped to their OIDC iss/sub (unknown → skipped);
// paths are the Cells web route of the node as the recipient sees it
// (tree AppearsIn: /ws-<slug>/<path>). Event handling never blocks the broker:
// events go through a bounded backlog to one resolver goroutine.

import (
	"context"
	"path"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"go.uber.org/zap"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/broker"
	"github.com/pydio/cells/v5/common/client/commons/treec"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/activity"
	"github.com/pydio/cells/v5/common/proto/chat"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/jobs"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/telemetry/log"
)

const (
	kailoNotifyWindow  = 60 * time.Second
	kailoNotifyTaskMin = 30 // seconds a finished background task must have run
	kailoNotifyBacklog = 1024
	kailoNotifyInbox   = "inbox" // broker/activity BoxInbox
)

type kailoNotify struct {
	notifier *auth.NativeOIDCNotifier
	updates  *auth.NativeOIDCNotifyAggregator
	events   chan func(context.Context)
	dropped  atomic.Int64
}

// startKailoNotify subscribes the native event sources when the delivery is
// enabled (Kailo mode and directory client delivered); otherwise nothing.
func startKailoNotify(ctx context.Context) error {
	n, err := auth.StartNativeOIDCNotifier(ctx)
	if err != nil || n == nil {
		// A partial directory delivery is refused and logged by the directory sync.
		return nil
	}
	k := &kailoNotify{notifier: n, updates: &auth.NativeOIDCNotifyAggregator{Window: kailoNotifyWindow},
		events: make(chan func(context.Context), kailoNotifyBacklog)}
	counter := broker.WithCounterName("kailo-notify")
	for topic, handler := range map[string]broker.SubscriberHandler{
		common.TopicActivityEvent: k.onActivity,
		common.TopicChatEvent:     k.onChat,
		common.TopicJobTaskEvent:  k.onTask,
	} {
		if err := broker.SubscribeCancellable(ctx, topic, handler, counter); err != nil {
			log.Logger(ctx).Warn("Kailo notification source unavailable", zap.String("topic", topic))
		}
	}
	go k.run(ctx)
	return nil
}

func (k *kailoNotify) later(f func(context.Context)) {
	select {
	case k.events <- f:
	default:
		k.dropped.Add(1)
	}
}

func (k *kailoNotify) run(ctx context.Context) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	reported := int64(0)
	for {
		select {
		case <-ctx.Done():
			return
		case f := <-k.events:
			f(ctx)
		case now := <-ticker.C:
			for _, b := range k.updates.Due(now) {
				k.flush(ctx, b)
			}
			if d := k.dropped.Load(); d != reported {
				reported = d
				log.Logger(ctx).Warn("Kailo notification backlog full; events dropped", zap.Int64("dropped", d))
			}
		}
	}
}

// ---- broker handlers (no I/O here) ------------------------------------------

func (k *kailoNotify) onActivity(ctx context.Context, msg broker.Message) error {
	event := &activity.PostActivityEvent{}
	if _, err := msg.Unmarshal(ctx, event); err != nil {
		return nil
	}
	if event.OwnerType != activity.OwnerType_USER || event.BoxName != kailoNotifyInbox || event.Activity == nil {
		return nil
	}
	k.later(func(ctx context.Context) { k.activity(ctx, event.OwnerId, event.Activity) })
	return nil
}

func (k *kailoNotify) onChat(ctx context.Context, msg broker.Message) error {
	event := &chat.ChatEvent{}
	if _, err := msg.Unmarshal(ctx, event); err != nil {
		return nil
	}
	m, room := event.GetMessage(), event.GetRoom()
	// New node comments only: no room PUT/DELETE, no message deletion or edit.
	if event.Details != "" || m == nil || room == nil || room.Type != chat.RoomType_NODE || room.RoomTypeObject == "" ||
		m.Author == "" || len(m.GetActivity().GetItems()) > 0 {
		return nil
	}
	mentions := auth.NativeOIDCMentions(m.Message)
	if len(mentions) == 0 {
		return nil
	}
	k.later(func(ctx context.Context) { k.mentioned(ctx, m, room.RoomTypeObject, mentions) })
	return nil
}

func (k *kailoNotify) onTask(ctx context.Context, msg broker.Message) error {
	event := &jobs.TaskChangeEvent{}
	if _, err := msg.Unmarshal(ctx, event); err != nil {
		return nil
	}
	t, job := event.GetTaskUpdated(), event.GetJob()
	if t == nil || job == nil || t.Status != jobs.TaskStatus_Finished || job.Owner == "" ||
		job.Owner == common.PydioSystemUsername || len(job.Actions) == 0 ||
		t.StartTime <= 0 || t.EndTime-t.StartTime < kailoNotifyTaskMin {
		return nil
	}
	k.later(func(ctx context.Context) { k.taskCompleted(ctx, job, t) })
	return nil
}

// ---- resolution ----------------------------------------------------------------

type kailoPerson struct {
	user *idm.User
	ref  auth.NativeOIDCPerson
	ok   bool // has an OIDC identity
}

func (p kailoPerson) name() string {
	if p.user == nil {
		return ""
	}
	if n := strings.TrimSpace(p.user.GetAttributes()[idm.UserAttrDisplayName]); n != "" {
		return n
	}
	return p.user.Login
}

func (p kailoPerson) actor() *auth.NativeOIDCPerson {
	if !p.ok {
		return nil
	}
	ref := p.ref
	return &ref
}

func (k *kailoNotify) person(ctx context.Context, login string) kailoPerson {
	if login == "" || login == common.PydioSystemUsername {
		return kailoPerson{}
	}
	user, err := permissions.SearchUniqueUser(ctx, login, "")
	if (err != nil || user == nil) && strings.ToLower(login) != login {
		user, err = permissions.SearchUniqueUser(ctx, strings.ToLower(login), "")
	}
	if err != nil || user == nil || user.IsGroup {
		return kailoPerson{}
	}
	ref, ok := auth.NativeOIDCUserIdentity(ctx, user)
	return kailoPerson{user: user, ref: ref, ok: ok}
}

// nodeFor reads a node through the recipient's own UUID router (ACL check)
// and returns its Cells web route and display name in the recipient's view,
// preferring a workspace over a Cell; never a public link.
func (k *kailoNotify) nodeFor(ctx context.Context, user *idm.User, uuid string) (string, string, bool) {
	if user == nil || uuid == "" {
		return "", "", false
	}
	resp, err := compose.UuidClient().ReadNode(auth.WithImpersonate(ctx, user), &tree.ReadNodeRequest{Node: &tree.Node{Uuid: uuid}})
	if err != nil || resp.GetNode() == nil {
		return "", "", false
	}
	for _, scope := range []string{idm.WorkspaceScope_ADMIN.String(), idm.WorkspaceScope_ROOM.String()} {
		for _, in := range resp.GetNode().GetAppearsIn() {
			if in.GetWsScope() != scope || in.GetWsSlug() == "" {
				continue
			}
			p, ok := auth.NativeCellsPagePath(in.GetWsSlug(), in.GetPath())
			if !ok {
				continue
			}
			name := path.Base(strings.Trim(in.GetPath(), "/"))
			if strings.Trim(in.GetPath(), "/") == "" {
				name = in.GetWsLabel()
			}
			return p, name, true
		}
	}
	return "", "", false
}

func occurredAt(seconds int64) string {
	if seconds <= 0 {
		return ""
	}
	return time.Unix(seconds, 0).UTC().Format(time.RFC3339)
}

// notify queues one delivery; the actor is omitted when it has no identity.
func (k *kailoNotify) notify(ctx context.Context, key, category string, to, by kailoPerson, title auth.NativeOIDCText, target, at string) {
	k.notifier.Enqueue(ctx, auth.NativeOIDCNotification{
		IdempotencyKey: key,
		Recipient:      to.ref,
		Actor:          by.actor(),
		Category:       category,
		Title:          title,
		Path:           target,
		OccurredAt:     at,
	})
}

// ---- event mapping ---------------------------------------------------------------

func (k *kailoNotify) activity(ctx context.Context, recipient string, ac *activity.Object) {
	actor := ac.GetActor().GetId()
	if recipient == "" || actor == "" || actor == recipient || actor == common.PydioSystemUsername {
		return
	}
	switch ac.Type {
	case activity.ObjectType_Share:
		k.shared(ctx, recipient, actor, ac)
	case activity.ObjectType_UpdateComment:
		k.commented(ctx, recipient, actor, ac)
	case activity.ObjectType_Create, activity.ObjectType_Update, activity.ObjectType_Delete, activity.ObjectType_Move:
		k.changed(recipient, actor, ac)
	}
}

func (k *kailoNotify) shared(ctx context.Context, recipient, actor string, ac *activity.Object) {
	id := ac.GetObject().GetId()
	if id == "" {
		return
	}
	ws, err := permissions.SearchUniqueWorkspace(ctx, id, "")
	if err != nil || ws == nil || ws.Scope == idm.WorkspaceScope_LINK || ws.Slug == "" ||
		strings.HasPrefix(ws.Slug, auth.NativeOIDCWorkspaceRolePrefix) {
		return
	}
	to := k.person(ctx, recipient)
	target, ok := auth.NativeCellsPagePath(ws.Slug, "")
	if !to.ok || !ok {
		return
	}
	by := k.person(ctx, actor)
	seconds := ac.GetUpdated().GetSeconds()
	key := auth.NativeOIDCNotifyKey("shared", id, recipient, actor, strconv.FormatInt(seconds, 10))
	k.notify(ctx, key, auth.NativeOIDCNotifyShared, to, by, auth.NativeOIDCNotifyTitle("shared", by.name(), ws.Label, 0), target, occurredAt(seconds))
}

func (k *kailoNotify) commented(ctx context.Context, recipient, actor string, ac *activity.Object) {
	id := ac.GetObject().GetId()
	text := ""
	if items := ac.GetItems(); len(items) > 0 {
		text = items[0].GetSummary()
	}
	// A mentioned follower gets MENTIONED (chat event) instead.
	if slices.ContainsFunc(auth.NativeOIDCMentions(text), func(m string) bool { return strings.EqualFold(m, recipient) }) {
		return
	}
	to := k.person(ctx, recipient)
	if !to.ok {
		return
	}
	target, name, ok := k.nodeFor(ctx, to.user, id)
	if !ok {
		return
	}
	by := k.person(ctx, actor)
	seconds := ac.GetUpdated().GetSeconds()
	key := auth.NativeOIDCNotifyKey("commented", id, recipient, actor, strconv.FormatInt(seconds, 10), text)
	k.notify(ctx, key, auth.NativeOIDCNotifyCommented, to, by, auth.NativeOIDCNotifyTitle("commented", by.name(), name, 0), target, occurredAt(seconds))
}

func (k *kailoNotify) mentioned(ctx context.Context, m *chat.ChatMessage, node string, mentions []string) {
	by := k.person(ctx, m.Author)
	for _, login := range mentions {
		if strings.EqualFold(login, m.Author) {
			continue
		}
		to := k.person(ctx, login)
		if !to.ok || to.user.Login == m.Author {
			continue
		}
		target, name, ok := k.nodeFor(ctx, to.user, node)
		if !ok {
			continue
		}
		event := m.Uuid
		if event == "" {
			event = node + "/" + m.Author + "/" + strconv.FormatInt(m.Timestamp, 10) + "/" + m.Message
		}
		key := auth.NativeOIDCNotifyKey("mentioned", event, to.user.Login)
		k.notify(ctx, key, auth.NativeOIDCNotifyMentioned, to, by, auth.NativeOIDCNotifyTitle("mentioned", by.name(), name, 0), target, occurredAt(m.Timestamp))
	}
}

func (k *kailoNotify) changed(recipient, actor string, ac *activity.Object) {
	obj := ac.GetObject()
	full := strings.TrimSuffix(obj.GetName(), "/")
	if obj.GetId() == "" || full == "" {
		return
	}
	event := map[activity.ObjectType]string{activity.ObjectType_Create: "created", activity.ObjectType_Update: "updated",
		activity.ObjectType_Delete: "deleted", activity.ObjectType_Move: "moved"}[ac.Type]
	at := time.Now()
	if seconds := ac.GetUpdated().GetSeconds(); seconds > 0 {
		at = time.Unix(seconds, 0)
	}
	k.updates.Add(auth.NativeOIDCNotifyChange{Recipient: recipient, Folder: path.Dir(full), Node: obj.GetId(),
		Name: path.Base(full), Actor: actor, Event: event, At: at})
}

func (k *kailoNotify) flush(ctx context.Context, b *auth.NativeOIDCNotifyBatch) {
	to := k.person(ctx, b.Recipient)
	if !to.ok || len(b.Changes) == 0 {
		return
	}
	// The folder is an internal tree path: resolve its UUID, then read it in
	// the recipient's own view (ACL and workspace route).
	folder, err := treec.NodeProviderClient(ctx).ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Path: b.Folder}})
	if err != nil || folder.GetNode().GetUuid() == "" {
		return
	}
	target, folderName, ok := k.nodeFor(ctx, to.user, folder.GetNode().GetUuid())
	if !ok {
		return
	}
	by := k.person(ctx, b.Actor())
	var title auth.NativeOIDCText
	if len(b.Changes) == 1 {
		c := b.Changes[0]
		if c.Event != "deleted" {
			if p, _, ok := k.nodeFor(ctx, to.user, c.Node); ok {
				target = p
			}
		}
		title = auth.NativeOIDCNotifyTitle(c.Event, by.name(), c.Name, 1)
	} else {
		title = auth.NativeOIDCNotifyTitle("changes", by.name(), folderName, len(b.Changes))
	}
	last := b.First
	for _, c := range b.Changes {
		if c.At.After(last) {
			last = c.At
		}
	}
	k.notify(ctx, b.Key(), auth.NativeOIDCNotifyUpdated, to, by, title, target, occurredAt(last.Unix()))
}

func (k *kailoNotify) taskCompleted(ctx context.Context, job *jobs.Job, t *jobs.Task) {
	action := job.Actions[0]
	params := action.GetParameters()
	// Owner-scope targets are "<workspace slug>/<path>" as the owner sees them.
	target := strings.Trim(params["target"], "/")
	folder, event := target, ""
	switch action.ID {
	case "actions.archive.compress":
		event = "compress"
	case "actions.archive.extract":
		event = "extract"
	case "actions.tree.copymove":
		// Deletion to / restore from the recycle bin is not a user task result.
		if strings.Contains(target, common.RecycleBinName) || (params["type"] != "copy" && params["type"] != "move") {
			return
		}
		event = params["type"]
		if params["targetParent"] != "true" {
			folder = path.Dir(target)
		}
	default:
		return
	}
	slug, relative, _ := strings.Cut(folder, "/")
	if slug == "" || slug == "." {
		return
	}
	owner := k.person(ctx, job.Owner)
	if !owner.ok {
		return
	}
	// Read back as the owner: the route must open something they can read.
	if _, err := compose.PathClient().ReadNode(auth.WithImpersonate(ctx, owner.user), &tree.ReadNodeRequest{Node: &tree.Node{Path: folder}}); err != nil {
		return
	}
	link, ok := auth.NativeCellsPagePath(slug, relative)
	if !ok {
		return
	}
	title := auth.NativeOIDCNotifyTitle(event, "", path.Base(folder), 0)
	k.notify(ctx, auth.NativeOIDCNotifyKey("task", job.ID, t.ID), auth.NativeOIDCNotifyTaskCompleted, owner, kailoPerson{}, title, link, occurredAt(int64(t.EndTime)))
}
