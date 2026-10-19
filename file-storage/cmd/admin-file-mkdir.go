package cmd

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/spf13/cobra"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/nodes/compose"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/tree"
)

var (
	mkdirPath string
	mkdirUser string
)

var mkdirCmd = &cobra.Command{
	Use:   "mkdir",
	Short: "Ensure a top-level folder of a datasource exists",
	Long: `
DESCRIPTION

  Ensure the folder <datasource>/<name> exists in the admin tree, creating it
  through the original admin router when it is missing, and print its node
  UUID. An existing folder is left untouched; an existing file at that path is
  refused. Only one level below a datasource root is accepted, so that a
  workspace can be rooted on a real folder rather than on a datasource root.

EXAMPLE

  $ ` + os.Args[0] + ` admin file mkdir --path kailobinding/kailo-binding --user admin
`,
	RunE: func(cmd *cobra.Command, args []string) error {
		parts := strings.Split(mkdirPath, "/")
		if len(parts) != 2 || mkdirUser == "" {
			return errors.New("--path <datasource>/<folder> and --user are required")
		}
		for _, part := range parts {
			if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\\x00\r\n") {
				return errors.New("invalid folder path")
			}
		}
		ctx := auth.WithImpersonate(cmd.Context(), &idm.User{Login: mkdirUser})
		router := compose.PathClientAdmin()
		read := func() (*tree.Node, error) {
			r, err := router.ReadNode(ctx, &tree.ReadNodeRequest{Node: &tree.Node{Path: mkdirPath}})
			if err != nil {
				return nil, err
			}
			return r.GetNode(), nil
		}
		node, err := read()
		if err != nil {
			if !errors.Is(err, errors.NodeNotFound) && !errors.Is(err, errors.StatusNotFound) {
				return err
			}
			if _, err = router.CreateNode(ctx, &tree.CreateNodeRequest{Node: &tree.Node{
				Path:  mkdirPath,
				Type:  tree.NodeType_COLLECTION,
				MTime: time.Now().Unix(),
			}}); err != nil {
				return err
			}
			if node, err = read(); err != nil {
				return err
			}
		}
		if node.GetType() != tree.NodeType_COLLECTION || node.GetUuid() == "" {
			return errors.New("path exists and is not a folder")
		}
		fmt.Println(node.GetUuid())
		return nil
	},
}

func init() {
	mkdirCmd.Flags().StringVar(&mkdirPath, "path", "", "Folder path <datasource>/<folder> in the admin tree")
	mkdirCmd.Flags().StringVar(&mkdirUser, "user", "", "Existing login used to impersonate the creation")
	FileCmd.AddCommand(mkdirCmd)
}
