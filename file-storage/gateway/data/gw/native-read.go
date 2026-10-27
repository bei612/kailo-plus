package pydio

import (
	"bytes"
	"io"
)

// Only the already-read bounded body is held here. A slow MinIO consumer must
// not keep disclosing it after the original authority is revoked. Earlier
// disclosed bytes and the completed native receipt remain historical facts.
type nativeDownloadReader struct {
	body    *bytes.Reader
	fresh   func() error
	failure error
}

func (r *nativeDownloadReader) Read(buffer []byte) (int, error) {
	if r.failure != nil {
		return 0, r.failure
	}
	if len(buffer) == 0 {
		return 0, nil
	}
	if r.body.Len() == 0 {
		return 0, io.EOF
	}
	if err := r.fresh(); err != nil {
		// The first refusal retires this disclosure, even if a later request
		// could be authorized. Repeated Read calls cannot poll or revive it.
		r.failure = err
		return 0, err
	}
	return r.body.Read(buffer)
}
