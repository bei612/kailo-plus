//go:build storage || kv

/*
 * Copyright (c) 2019-2021. Abstrium SAS <team (at) pydio.com>
 * This file is part of Pydio Cells.
 *
 * Pydio Cells is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Pydio Cells is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with Pydio Cells.  If not, see <http://www.gnu.org/licenses/>.
 *
 * The latest code can be found at <https://pydio.com>.
 */

package dao

import (
	"context"
	"encoding/binary"
	"sync"
	"testing"
	"time"

	"go.etcd.io/bbolt"
	"google.golang.org/protobuf/proto"

	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/tree"
	"github.com/pydio/cells/v5/common/runtime/manager"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/common/utils/uuid"
	"github.com/pydio/cells/v5/data/versions"
	"github.com/pydio/cells/v5/data/versions/dao/bolt"
	"github.com/pydio/cells/v5/data/versions/dao/mongo"

	. "github.com/smartystreets/goconvey/convey"
)

var (
	testcases = []test.StorageTestCase{
		test.TemplateBoltWithPrefix(bolt.NewBoltStore, "versions_bolt_"),
		test.TemplateMongoEnvWithPrefix(mongo.NewMongoDAO, "data_"+uuid.New()[:6]+"_"),
	}
)

type legacyVersion struct {
	NodeUuid  string `bson:"node_uuid"`
	VersionId string `bson:"version_id"`
	Timestamp int64  `bson:"ts"`
	*tree.ChangeLog
}

func TestDAO_CRUD(t *testing.T) {

	test.RunStorageTests(testcases, t, func(ctx context.Context) {
		Convey("Test CRUD", t, func() {

			bs, err := manager.Resolve[versions.DAO](ctx)
			So(err, ShouldBeNil)

			e := bs.StoreVersion(ctx, "uuid", &tree.ContentRevision{VersionId: "version1", ETag: "etag1", OwnerName: "user1", Event: &tree.NodeChangeEvent{}})
			So(e, ShouldBeNil)
			e = bs.StoreVersion(ctx, "uuid", &tree.ContentRevision{VersionId: "version2", ETag: "etag2", OwnerName: "user2", OwnerUuid: "user2id", Draft: true, Event: &tree.NodeChangeEvent{}})
			So(e, ShouldBeNil)
			e = bs.StoreVersion(ctx, "uuid", &tree.ContentRevision{VersionId: "version3", ETag: "etag3", OwnerName: "user2", OwnerUuid: "user2id", Event: &tree.NodeChangeEvent{}})
			So(e, ShouldBeNil)

			{
				var results []*tree.ContentRevision
				logs, _ := bs.GetVersions(ctx, "uuid", 0, 0, "", false, nil)
				for log := range logs {
					results = append(results, log)
				}
				So(results, ShouldHaveLength, 3)
			}
			{
				var results []*tree.ContentRevision
				logs, _ := bs.GetVersions(ctx, "uuid", 0, 0, "", false, map[string]any{"draftStatus": "draft"})
				for log := range logs {
					results = append(results, log)
				}
				So(results, ShouldHaveLength, 1)
			}
			{
				var results []*tree.ContentRevision
				logs, _ := bs.GetVersions(ctx, "uuid", 0, 0, "", false, map[string]any{"draftStatus": "published"})
				for log := range logs {
					results = append(results, log)
				}
				So(results, ShouldHaveLength, 2)
			}
			{
				var results []*tree.ContentRevision
				logs, _ := bs.GetVersions(ctx, "uuid", 0, 0, "", false, map[string]any{"ownerUuid": "user2id"})
				for log := range logs {
					results = append(results, log)
				}
				So(results, ShouldHaveLength, 2)
			}
			{
				var results []*tree.ContentRevision
				logs, _ := bs.GetVersions(ctx, "uuid", 0, 0, "", false, map[string]any{"ownerUuid": "user2id", "draftStatus": "draft"})
				for log := range logs {
					results = append(results, log)
				}
				So(results, ShouldHaveLength, 1)
			}

			var versionIds []string
			versions, finish, errChan := bs.ListAllVersionedNodesUuids(ctx)
		loop2:
			for {
				select {
				case v := <-versions:
					versionIds = append(versionIds, v)
				case <-finish:
					break loop2
				case <-errChan:
					break loop2
				}
			}

			So(versionIds, ShouldHaveLength, 1)

			last, e := bs.GetLastVersion(ctx, "uuid")
			So(last.VersionId, ShouldEqual, "version3")
			So(last.ETag, ShouldEqual, "etag3")

			specific, e := bs.GetVersion(ctx, "uuid", "version2")
			So(specific.VersionId, ShouldEqual, "version2")
			So(string(specific.ETag), ShouldEqual, "etag2")

			nonExisting, e := bs.GetLastVersion(ctx, "noid")
			So(e, ShouldBeNil)
			So(nonExisting, ShouldBeNil)

			nonExisting, e = bs.GetVersion(ctx, "uuid", "wrongVersion")
			So(e, ShouldNotBeNil)
			So(errors.Is(e, errors.VersionNotFound), ShouldBeTrue)

			ee := bs.DeleteVersionsForNode(ctx, "uuid")
			So(ee, ShouldBeNil)

			results := []*tree.ContentRevision{}
			logs, _ := bs.GetVersions(ctx, "uuid", 0, 0, "", false, nil)
			for log := range logs {
				results = append(results, log)
			}
			So(results, ShouldHaveLength, 0)
		})

	})

	test.RunStorageTests(testcases, t, func(ctx context.Context) {
		Convey("Test DeleteVersionsForNode", t, func() {

			bs, err := manager.Resolve[versions.DAO](ctx)
			So(err, ShouldBeNil)

			e := bs.StoreVersion(ctx, "uuid", &tree.ContentRevision{VersionId: "version1", ETag: "etag1", OwnerName: "user", Event: &tree.NodeChangeEvent{}})
			So(e, ShouldBeNil)
			e = bs.StoreVersion(ctx, "uuid", &tree.ContentRevision{VersionId: "version2", ETag: "etag2", OwnerName: "user", Event: &tree.NodeChangeEvent{}})
			So(e, ShouldBeNil)
			e = bs.StoreVersion(ctx, "uuid", &tree.ContentRevision{VersionId: "version3", ETag: "etag3", OwnerName: "user", Event: &tree.NodeChangeEvent{}})
			So(e, ShouldBeNil)

			err = bs.DeleteVersionsForNode(ctx, "uuid", "version2")
			So(err, ShouldBeNil)

			var results []*tree.ContentRevision
			logs, _ := bs.GetVersions(ctx, "uuid", 0, 0, "", false, nil)
			for log := range logs {
				results = append(results, log)
			}
			So(results, ShouldHaveLength, 2)

		})
	})

	test.RunStorageTests(testcases, t, func(ctx context.Context) {
		Convey("Test Backward Compat ChangeLog => ContentRevision", t, func() {
			bs, err := manager.Resolve[versions.DAO](ctx)
			So(err, ShouldBeNil)
			if boltStore, ok := bs.(*bolt.BoltStore); ok {
				err = boltStore.Update(func(tx *bbolt.Tx) error {

					bucket := tx.Bucket([]byte("versions"))
					if bucket == nil {
						return errors.WithStack(errors.BucketNotFound)
					}
					nodeBucket, err := bucket.CreateBucketIfNotExists([]byte("legacy_uuid"))
					if err != nil {
						return err
					}
					newValue, e := proto.Marshal(&tree.ChangeLog{Uuid: "version1", OwnerUuid: "user", Data: []byte("etag1")})
					if e != nil {
						return e
					}

					objectKey, _ := nodeBucket.NextSequence()
					k := make([]byte, 8)
					binary.BigEndian.PutUint64(k, objectKey)
					return nodeBucket.Put(k, newValue)
				})
				So(err, ShouldBeNil)

			} else if ms, ok1 := bs.(*mongo.MongoStore); ok1 {

				mv := &legacyVersion{
					NodeUuid:  "legacy_uuid",
					VersionId: "version1",
					Timestamp: time.Now().UnixNano(),
					ChangeLog: &tree.ChangeLog{Uuid: "version1", Data: []byte("etag1"), OwnerUuid: "user"},
				}
				_, e := ms.Collection("versions").InsertOne(ctx, mv)
				So(e, ShouldBeNil)

			}

			var results []*tree.ContentRevision
			logs, _ := bs.GetVersions(ctx, "legacy_uuid", 0, 0, "", false, nil)
			for log := range logs {
				So(log, ShouldNotBeNil)
				results = append(results, log)
			}

			So(results, ShouldHaveLength, 1)
			So(results[0].VersionId, ShouldEqual, "version1")
			So(results[0].ETag, ShouldEqual, "etag1")
			So(results[0].OwnerName, ShouldEqual, "user")

		})
	})

}

func TestNativeDraftUploadReservation(t *testing.T) {
	test.RunStorageTests(testcases, t, func(ctx context.Context) {
		dao, err := manager.Resolve[versions.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		deadline := time.Now().Add(time.Hour)
		canceled, cancel := context.WithCancel(ctx)
		cancel()
		if _, err := dao.DraftUploads(canceled, deadline, 1); !errors.Is(err, context.Canceled) {
			t.Fatalf("native cleanup scan ignored cancellation: %v", err)
		}
		newDraft := func(id string) *tree.ContentRevision {
			return &tree.ContentRevision{VersionId: id, Draft: true, OwnerUuid: "native-owner", Size: 4,
				Event:    &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_CREATE},
				Location: &tree.Node{Uuid: "object-" + id, Path: "versions/object-" + id}}
		}
		pending := newDraft("pending")
		if err := dao.ReserveDraftUpload(ctx, "native-node", pending, deadline); err != nil {
			t.Fatal(err)
		}
		for _, different := range []bool{false, true} {
			repeated := proto.Clone(pending).(*tree.ContentRevision)
			if different {
				repeated.OwnerUuid = "different-owner"
			}
			if err := dao.ReserveDraftUpload(ctx, "native-node", repeated, deadline); !errors.Is(err, errors.StatusConflict) {
				t.Fatalf("duplicate reservation returned a writable location: different=%v err=%v", different, err)
			}
		}
		assertHidden := func(id string) {
			t.Helper()
			if _, err := dao.GetVersion(ctx, "native-node", id); !errors.Is(err, errors.StatusConflict) {
				t.Fatalf("uncertain bytes became readable or reusable: %s %v", id, err)
			}
			stream, err := dao.GetVersions(ctx, "native-node", 0, 0, "", false, nil)
			if err != nil {
				t.Fatal(err)
			}
			for revision := range stream {
				if revision.VersionId == id {
					t.Errorf("uncertain draft leaked into original listing: %s", id)
				}
			}
			last, err := dao.GetLastVersion(ctx, "native-node")
			if err != nil || last.GetVersionId() == id {
				t.Fatalf("uncertain draft became last revision: %v %v", last, err)
			}
		}
		assertHidden(pending.VersionId)
		confirmed := proto.Clone(pending).(*tree.ContentRevision)
		confirmed.ETag, confirmed.ContentHash = "native-etag", "native-hash"
		for _, invalid := range []*versions.DraftUpload{
			nil,
			{NodeUuid: "native-node", Deadline: deadline.UnixNano(), State: versions.DraftUploadPending},
			{NodeUuid: "native-node", Deadline: deadline.UnixNano(), Revision: pending, State: "FUTURE_NATIVE_STATE"},
		} {
			if err := versions.ValidateDraftCompletion(invalid, confirmed, time.Now()); !errors.Is(err, errors.StatusConflict) {
				t.Fatalf("unknown or corrupt native reservation became a byte ACK: %v", err)
			}
		}
		changed := proto.Clone(confirmed).(*tree.ContentRevision)
		changed.Location.Path = "other-object"
		if err := dao.CompleteDraftUpload(ctx, "native-node", changed, time.Now()); !errors.Is(err, errors.StatusConflict) {
			t.Fatalf("byte ACK replaced frozen location: %v", err)
		}
		if err := dao.StoreVersion(ctx, "native-node", confirmed); !errors.Is(err, errors.StatusConflict) {
			t.Fatalf("ordinary StoreVersion bypassed native completion: %v", err)
		}
		if err := dao.CompleteDraftUpload(ctx, "native-node", confirmed, time.Now()); err != nil {
			t.Fatal(err)
		}
		// A lost completion ACK observes the same immutable native result. It
		// does not return another object-write reservation.
		if err := dao.CompleteDraftUpload(ctx, "native-node", confirmed, deadline.Add(time.Second)); err != nil {
			t.Fatal(err)
		}
		stored, err := dao.GetVersion(ctx, "native-node", confirmed.VersionId)
		if err != nil || !proto.Equal(stored, confirmed) {
			t.Fatalf("completed native receipt changed: %v %v", stored, err)
		}
		if _, err := dao.FenceDraftUpload(ctx, "native-node", confirmed.VersionId, deadline.Add(time.Second)); !errors.Is(err, errors.StatusConflict) {
			t.Fatalf("expiration destroyed an acknowledged revision: %v", err)
		}
		late := newDraft("late")
		if err := dao.ReserveDraftUpload(ctx, "native-node", late, deadline); err != nil {
			t.Fatal(err)
		}
		if err := dao.CompleteDraftUpload(ctx, "native-node", &tree.ContentRevision{VersionId: late.VersionId, ETag: "late"}, deadline.Add(time.Second)); !errors.Is(err, errors.StatusConflict) {
			t.Fatalf("expired byte ACK became a revision: %v", err)
		}
		for _, deletion := range []func() error{
			func() error { return dao.DeleteVersionsForNode(ctx, "native-node", late.VersionId) },
			func() error { return dao.DeleteVersionsForNodes(ctx, []string{"native-node"}) },
		} {
			if err := deletion(); err != nil {
				t.Fatal(err)
			}
			assertHidden(late.VersionId)
			if err := dao.ReserveDraftUpload(ctx, "native-node", late, deadline); !errors.Is(err, errors.StatusConflict) {
				t.Fatalf("native delete retired the first-writer fence: %v", err)
			}
		}
		uploads, err := dao.DraftUploads(ctx, deadline.Add(time.Second), 1)
		if err != nil || len(uploads) != 1 {
			t.Fatalf("cleanup lost retained location: %v %v", uploads, err)
		}
		first := uploads[0]
		if _, err := dao.FenceDraftUpload(ctx, first.NodeUuid, first.Revision.VersionId, deadline.Add(time.Second)); err != nil {
			t.Fatal(err)
		}
		uploads, err = dao.DraftUploads(ctx, deadline.Add(2*time.Second), 1)
		if err != nil || len(uploads) != 1 || uploads[0].Revision.VersionId == first.Revision.VersionId {
			t.Fatalf("one cleanup failure starved the other native location: %v %v", uploads, err)
		}
		second := uploads[0]
		if _, err := dao.FenceDraftUpload(ctx, second.NodeUuid, second.Revision.VersionId, deadline.Add(2*time.Second)); err != nil {
			t.Fatal(err)
		}
		newer := newDraft("newer")
		if err := dao.ReserveDraftUpload(ctx, "native-node", newer, deadline.Add(3*time.Second)); err != nil {
			t.Fatal(err)
		}
		uploads, err = dao.DraftUploads(ctx, deadline.Add(4*time.Second), 1)
		if err != nil || len(uploads) != 1 || uploads[0].Revision.VersionId != first.Revision.VersionId {
			t.Fatalf("newly expired uploads starved an existing cleanup fence: %v %v", uploads, err)
		}
	})
}

// Exercise the original DAO and storage fixtures rather than a replacement
// receipt store: the native reference must resolve to one immutable result.
func TestDAO_NativeReference(t *testing.T) {
	test.RunStorageTests(testcases, t, func(ctx context.Context) {
		db, err := manager.Resolve[versions.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		revision := &tree.ContentRevision{VersionId: "native-reference", OwnerUuid: "native-owner", OwnerName: "native-user",
			ETag: "native-etag", Size: 7, Event: &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_CREATE}}
		requests := make([]*tree.ContentRevision, 16)
		for index := range requests {
			requests[index] = proto.Clone(revision).(*tree.ContentRevision)
		}
		var group sync.WaitGroup
		results := make(chan error, len(requests))
		for _, request := range requests {
			group.Add(1)
			go func(request *tree.ContentRevision) {
				defer group.Done()
				results <- db.StoreVersion(ctx, "native-node", request)
			}(request)
		}
		group.Wait()
		close(results)
		for err := range results {
			if err != nil {
				t.Errorf("identical concurrent native acknowledgement failed: %v", err)
			}
		}
		stored, err := db.GetVersion(ctx, "native-node", revision.VersionId)
		if err != nil || !proto.Equal(stored, revision) {
			t.Fatalf("native reference changed its owner/content: stored=%v err=%v", stored, err)
		}
		for _, change := range []func(*tree.ContentRevision){
			func(other *tree.ContentRevision) { other.OwnerUuid = "other-owner" },
			func(other *tree.ContentRevision) { other.ETag = "other-content" },
			func(other *tree.ContentRevision) { other.Size++ },
			func(other *tree.ContentRevision) { other.Draft = true },
		} {
			other := proto.Clone(revision).(*tree.ContentRevision)
			change(other)
			if err := db.StoreVersion(ctx, "native-node", other); !errors.Is(err, errors.StatusConflict) {
				t.Errorf("same native reference accepted changed actor/content: %v", err)
			}
		}
		if err := db.StoreVersion(ctx, "other-node", revision); err != nil {
			t.Errorf("another node could not use its own native reference: %v", err)
		}
		versions, err := db.GetVersions(ctx, "native-node", 0, 0, "", false, nil)
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		for stored := range versions {
			count++
			if !proto.Equal(stored, revision) {
				t.Error("repeated reference replaced the original stored result")
			}
		}
		if count != 1 {
			t.Errorf("concurrent/repeated native reference created %d stored results", count)
		}
		for _, request := range []struct {
			node     string
			revision *tree.ContentRevision
		}{{"", revision}, {"native-node", nil}, {"native-node", &tree.ContentRevision{}}} {
			if err := db.StoreVersion(ctx, request.node, request.revision); !errors.Is(err, errors.InvalidParameters) {
				t.Errorf("missing native reference did not refuse deterministically: %v", err)
			}
		}
	})
}

func TestDAO_AmbiguousNativeReference(t *testing.T) {
	test.RunStorageTests([]test.StorageTestCase{test.TemplateBoltWithPrefix(bolt.NewBoltStore, "versions_ambiguous_")}, t, func(ctx context.Context) {
		dao, err := manager.Resolve[versions.DAO](ctx)
		if err != nil {
			t.Fatal(err)
		}
		store := dao.(*bolt.BoltStore)
		revision := &tree.ContentRevision{VersionId: "old-duplicate", OwnerUuid: "native-owner", ETag: "native-etag",
			Event: &tree.NodeChangeEvent{Type: tree.NodeChangeEvent_CREATE}}
		if err := store.StoreVersion(ctx, "native-node", revision); err != nil {
			t.Fatal(err)
		}
		// Reproduce the fixed upstream's old duplicate row in its original Bolt
		// bucket; the public write path must not recreate this ambiguity.
		if err := store.Update(func(tx *bbolt.Tx) error {
			bucket := tx.Bucket([]byte("versions")).Bucket([]byte("native-node"))
			value, err := proto.Marshal(revision)
			if err != nil {
				return err
			}
			sequence, err := bucket.NextSequence()
			if err != nil {
				return err
			}
			key := make([]byte, 8)
			binary.BigEndian.PutUint64(key, sequence)
			return bucket.Put(key, value)
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := store.GetVersion(ctx, "native-node", revision.VersionId); !errors.Is(err, errors.StatusConflict) {
			t.Errorf("ambiguous old native results selected a successful version: %v", err)
		}
		if err := store.StoreVersion(ctx, "native-node", revision); !errors.Is(err, errors.StatusConflict) {
			t.Errorf("ambiguous old native results became a confirmed retry: %v", err)
		}
	})
}
