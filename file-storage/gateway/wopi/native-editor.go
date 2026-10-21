package wopi

import (
	"errors"
	"net/url"
	"strings"

	"github.com/pydio/cells/v5/common/auth/claim"
)

// applyNativeEditorFacts completes CheckFileInfo for a native document PAT
// (no platform ProtocolSession), DD-132(2)(3):
//   - write is offered only when the node is writable AND the PAT carries the
//     rw scope (auth already enforces the single node scope and refuses PutFile
//     for r); the Cells ACL stays the authority;
//   - the editor page posts its messages to the Cells site origin only. Without
//     a valid site origin the request is refused: an empty PostMessageOrigin
//     makes the DocumentServer page fall back to '*' (SF-OFF-07).
func applyNativeEditorFacts(f *FileInfo, claims claim.Claims, siteURL string) error {
	if !claims.ProvidesScopes || len(claims.Scopes) != 1 {
		return errors.New("native document PAT must carry exactly one node scope")
	}
	origin, err := siteOrigin(siteURL)
	if err != nil {
		return err
	}
	f.UserCanWrite = f.UserCanWrite && strings.HasSuffix(claims.Scopes[0], ":rw")
	f.PostMessageOrigin = origin
	return nil
}

func siteOrigin(raw string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil {
		return "", errors.New("the Cells site URL is not an explicit http(s) origin")
	}
	return u.Scheme + "://" + u.Host, nil
}
