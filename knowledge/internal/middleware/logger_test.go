package middleware

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSanitizeBody(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{
			name: "browser device credentials",
			in: `{"pairing_link":"wss://example.com/#secret",` +
				`"next_token":"new-secret","deviceToken":"device-secret"}`,
			want: `{"pairing_link":"***","next_token":"***","deviceToken":"***"}`,
		},
		{
			name: "camelCase apiKey",
			in:   `{"modelName":"gpt-5.2","apiKey":"sk-secret-123","provider":"azure_openai"}`,
			want: `{"modelName":"gpt-5.2","apiKey":"***","provider":"azure_openai"}`,
		},
		{
			name: "snake_case api_key",
			in:   `{"api_key":"sk-secret-123"}`,
			want: `{"api_key":"***"}`,
		},
		{
			name: "PascalCase APIKey",
			in:   `{"APIKey":"sk-secret-123"}`,
			want: `{"APIKey":"***"}`,
		},
		{
			name: "secretKey camelCase",
			in:   `{"secretKey":"abc","accessKeyId":"id"}`,
			want: `{"secretKey":"***","accessKeyId":"id"}`,
		},
		{
			name: "refreshToken / accessToken camelCase",
			in:   `{"refreshToken":"rt","accessToken":"at"}`,
			want: `{"refreshToken":"***","accessToken":"***"}`,
		},
		{
			name: "password and token preserved as masked",
			in:   `{"password":"p","token":"t"}`,
			want: `{"password":"***","token":"***"}`,
		},
		{
			name: "sandbox terminal handshake ticket in JSON body",
			in:   `{"success":true,"data":{"ticket":"eyJhbGciOiJIUzI1NiJ9.payload.signature","expires_in":120}}`,
			want: `{"success":true,"data":{"ticket":"***","expires_in":120}}`,
		},
		{
			name: "snake_case new_password and old_password",
			in:   `{"email":"alice@example.com","new_password":"FreshPass9","old_password":"OldPass9"}`,
			want: `{"email":"alice@example.com","new_password":"***","old_password":"***"}`,
		},
		{
			name: "extra whitespace around colon",
			in:   `{"apiKey"  :   "leak"}`,
			want: `{"apiKey":"***"}`,
		},
		{
			name: "non sensitive fields untouched",
			in:   `{"baseUrl":"https://example.com","modelName":"gpt"}`,
			want: `{"baseUrl":"https://example.com","modelName":"gpt"}`,
		},
		{
			name: "OAuth authorization response fields",
			in:   `{"authorization_url":"https://idp.example/authorize?state=secret","authorization_attempt":"secret-state"}`,
			want: `{"authorization_url":"***","authorization_attempt":"***"}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeBody(tc.in)
			if got != tc.want {
				t.Errorf("sanitizeBody(%q)\n got: %s\nwant: %s", tc.in, got, tc.want)
			}
		})
	}
}

func TestSanitizeQuery(t *testing.T) {
	got := sanitizeQuery("code=secret-code&state=secret-state&next=%2Fsettings&state=second")
	want := "code=%2A%2A%2A&next=%2Fsettings&state=%2A%2A%2A"
	if got != want {
		t.Fatalf("sanitizeQuery() = %q, want %q", got, want)
	}
}

// The sandbox terminal presents its handshake credential as a query parameter
// because a browser WebSocket upgrade cannot carry Authorization. Holding that
// value for its TTL is enough to open a shell in the session's sandbox, so the
// redaction is a security boundary, not cosmetics.
func TestSanitizeQueryRedactsTerminalTicket(t *testing.T) {
	got := sanitizeQuery("ticket=eyJhbGciOiJIUzI1NiJ9.payload.signature&provision=1&cols=120")
	want := "cols=120&provision=1&ticket=%2A%2A%2A"
	if got != want {
		t.Fatalf("sanitizeQuery() = %q, want %q", got, want)
	}
	if strings.Contains(got, "signature") {
		t.Fatalf("sanitizeQuery() leaked the ticket: %q", got)
	}
}

// 07 §4.7.5: the IdP posts the signed logout_token as a form body to the
// back-channel receiver (/api/v1/auth/oidc/backchannel-logout); the access log
// must keep neither it nor other form credentials, and the handler must still
// read the original body.
func TestReadRequestBodyRedactsFormCredentials(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	body := "logout_token=eyJhbGciOiJSUzI1NiJ9.payload.signature&client_secret=s3cret&password=pw&keep=1"
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/oidc/backchannel-logout", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	got := readRequestBody(c)
	for _, leaked := range []string{"eyJhbGciOiJSUzI1NiJ9", "signature", "s3cret", "pw&"} {
		if strings.Contains(got, leaked) {
			t.Fatalf("readRequestBody() leaked %q: %q", leaked, got)
		}
	}
	if !strings.Contains(got, "keep=1") || !strings.Contains(got, "logout_token=%2A%2A%2A") {
		t.Fatalf("readRequestBody() = %q, want non-sensitive fields kept and logout_token redacted", got)
	}
	rest, err := io.ReadAll(c.Request.Body)
	if err != nil || string(rest) != body {
		t.Fatalf("handler body = %q, %v; want the original body", rest, err)
	}
}

func TestSanitizeBodyRedactsJSONLogoutToken(t *testing.T) {
	got := sanitizeBody(`{"logout_token":"eyJ.a.b","keep":"1"}`)
	if strings.Contains(got, "eyJ") || !strings.Contains(got, `"keep":"1"`) {
		t.Fatalf("sanitizeBody() = %q", got)
	}
}
