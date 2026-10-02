package common

import (
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/wire"

	"github.com/openmeterio/openmeter/app/config"
	"github.com/openmeterio/openmeter/openmeter/server"
	"github.com/openmeterio/openmeter/pkg/models"
	pkgserver "github.com/openmeterio/openmeter/pkg/server"
)

var Server = wire.NewSet(
	NewTelemetryRouterHook,
	NewFFXConfigContextMiddleware,
	NewRouterHooks,
	NewPostAuthMiddlewares,
	NewClientIPMiddleware,
)

func NewRouterHooks(
	telemetry TelemetryMiddlewareHook,
	cfg config.ServerConfig,
) (*server.RouterHooks, error) {
	if cfg.CoreServiceTokenFile == "" {
		return nil, errors.New("Core service token file is required")
	}
	contents, err := os.ReadFile(cfg.CoreServiceTokenFile)
	if err != nil {
		return nil, errors.New("Core service token file is unreadable")
	}
	token := strings.TrimSpace(string(contents))
	if token == "" || strings.ContainsAny(token, " \t\r\n") {
		return nil, errors.New("Core service token is empty or malformed")
	}
	expected := sha256.Sum256([]byte(token))
	authenticate := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			headers := r.Header.Values("Authorization")
			var provided [sha256.Size]byte
			var bearer bool
			if len(headers) == 1 {
				scheme, value, found := strings.Cut(headers[0], " ")
				bearer = found && strings.EqualFold(scheme, "Bearer") && value != ""
				provided = sha256.Sum256([]byte(value))
			}
			if !bearer || subtle.ConstantTimeCompare(provided[:], expected[:]) != 1 {
				w.Header().Set("WWW-Authenticate", "Bearer")
				models.NewStatusProblem(r.Context(), nil, http.StatusUnauthorized).Respond(w)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
	return &server.RouterHooks{
		Middlewares: []server.MiddlewareHook{
			func(m server.MiddlewareManager) { m.Use(authenticate) },
			server.MiddlewareHook(telemetry),
		},
	}, nil
}

func NewPostAuthMiddlewares(
	ffx FFXConfigContextMiddleware,
) server.PostAuthMiddlewares {
	return server.PostAuthMiddlewares{
		func(h http.Handler) http.Handler {
			return ffx(h)
		},
	}
}

// ClientIPMiddleware is a defined type (not an alias) so the wire graph does not
// provide the ubiquitous pkgserver.MiddlewareFunc type directly.
type ClientIPMiddleware pkgserver.MiddlewareFunc

func NewClientIPMiddleware(cfg config.ClientIPMiddlewareConfig) (ClientIPMiddleware, error) {
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("invalid client ip middleware config: %w", err)
	}

	switch cfg.Source {
	case config.ClientIPSourceRemoteAddr:
		return middleware.ClientIPFromRemoteAddr, nil
	case config.ClientIPSourceHeader:
		return middleware.ClientIPFromHeader(cfg.Header), nil
	case config.ClientIPSourceXFF:
		if len(cfg.TrustedIPPrefixes) > 0 {
			return middleware.ClientIPFromXFF(cfg.TrustedIPPrefixes...), nil
		}

		return middleware.ClientIPFromXFFTrustedProxies(cfg.TrustedProxies), nil
	default:
		return nil, fmt.Errorf("invalid client ip middleware source: %s", cfg.Source)
	}
}
