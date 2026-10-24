import { currentLocale } from '@/utils/kailoI18n';

// DD-152 (20 §13.8): form validation messages in both Kailo locales. Each
// leaf is [zh-CN, en]; ERROR_TEXTS resolves it when read (form rules and
// validators read it at validation time), so the shape callers use is
// unchanged: ERROR_TEXTS.SQL_PAIR.SQL.REQUIRED is a string.
type Pair = readonly [string, string];
type Tree = { readonly [key: string]: Pair | Tree };
type Localized<T> = {
  readonly [K in keyof T]: T[K] extends Pair ? string : Localized<T[K]>;
};

const isPair = (value: Pair | Tree): value is Pair => Array.isArray(value);

function localize<T extends Tree>(tree: T): Localized<T> {
  const out = {};
  for (const [key, value] of Object.entries(tree)) {
    if (isPair(value)) {
      Object.defineProperty(out, key, {
        enumerable: true,
        get: () => (currentLocale() === 'en' ? value[1] : value[0]),
      });
    } else {
      Object.defineProperty(out, key, {
        enumerable: true,
        value: localize(value),
      });
    }
  }
  return out as Localized<T>;
}

const texts = {
  CONNECTION: {
    DISPLAY_NAME: {
      REQUIRED: ['请输入显示名称', 'Enter a display name'],
    },
    PROJECT_ID: {
      REQUIRED: ['请输入项目 ID', 'Enter the project ID'],
    },
    DATASET_ID: {
      REQUIRED: ['请输入数据集 ID', 'Enter the dataset ID'],
    },
    CREDENTIAL: {
      REQUIRED: ['请上传凭据文件', 'Upload the credentials file'],
    },
    INIT_SQL: {
      REQUIRED: ['请输入初始化 SQL 语句', 'Enter the initial SQL statements'],
    },
    CONFIGURATION: {
      KEY: {
        REQUIRED: ['请输入配置项名称', 'Enter the configuration key'],
      },
      VALUE: {
        REQUIRED: ['请输入配置项的值', 'Enter the configuration value'],
      },
    },
    HOST: {
      REQUIRED: ['请输入主机地址', 'Enter the host'],
      INVALID: [
        '主机地址无效。在 macOS 或 Windows 上连接本机数据库时，请使用 host.docker.internal。',
        'Invalid host. To connect to a local database on macOS or Windows, use host.docker.internal.',
      ],
    },
    PORT: {
      REQUIRED: ['请输入端口', 'Enter the port'],
    },
    USER: {
      REQUIRED: ['请输入用户', 'Enter the user'],
    },
    USERNAME: {
      REQUIRED: ['请输入用户名', 'Enter the username'],
    },
    PASSWORD: {
      REQUIRED: ['请输入密码', 'Enter the password'],
    },
    DATABASE: {
      REQUIRED: ['请输入数据库名称', 'Enter the database name'],
    },
    SCHEMA: {
      REQUIRED: ['请输入 schema 名称', 'Enter the schema name'],
    },
    SCHEMAS: {
      REQUIRED: [
        '请输入以逗号分隔的 catalog.schema 列表',
        'Enter catalog.schema entries separated by commas',
      ],
    },
    ACCOUNT: {
      REQUIRED: ['请输入账户', 'Enter the account'],
    },
    S3_STAGING_DIR: {
      REQUIRED: ['请输入 S3 暂存目录', 'Enter the S3 staging directory'],
    },
    AWS_REGION: {
      REQUIRED: ['请输入 AWS 区域', 'Enter the AWS region'],
    },
    AWS_ACCESS_KEY: {
      REQUIRED: ['请输入 AWS 访问密钥 ID', 'Enter the AWS access key ID'],
    },
    AWS_SECRET_KEY: {
      REQUIRED: ['请输入 AWS 秘密访问密钥', 'Enter the AWS secret access key'],
    },
    AWS_ROLE_ARN: {
      REQUIRED: ['请输入 AWS 角色 ARN', 'Enter the AWS role ARN'],
    },
    WEB_IDENTITY_TOKEN: {
      REQUIRED: ['请输入 Web 身份令牌', 'Enter the web identity token'],
    },
    CLUSTER_IDENTIFIER: {
      REQUIRED: ['请输入集群标识符', 'Enter the cluster identifier'],
    },
    PRIVATE_KEY_FILE: {
      REQUIRED: ['请上传私钥文件', 'Upload a private key file'],
    },
    HTTP_PATH: {
      REQUIRED: ['请输入 HTTP 路径', 'Enter the HTTP path'],
    },
    PERSONAL_ACCESS_TOKEN: {
      REQUIRED: ['请输入个人访问令牌', 'Enter the personal access token'],
    },
    CLIENT_ID: {
      REQUIRED: ['请输入客户端 ID', 'Enter the client ID'],
    },
    CLIENT_SECRET: {
      REQUIRED: ['请输入客户端密钥', 'Enter the client secret'],
    },
  },
  ADD_RELATION: {
    FROM_FIELD: {
      REQUIRED: ['请选择字段', 'Select a field'],
    },
    TO_FIELD: {
      REQUIRED: ['请选择字段', 'Select a field'],
    },
    RELATION_TYPE: {
      REQUIRED: ['请选择关系类型', 'Select a relationship type'],
    },
    RELATIONSHIP: {
      EXIST: ['该关系已存在', 'This relationship already exists'],
    },
  },
  SETUP_MODEL: {
    TABLE: {
      REQUIRED: ['请至少选择一张表', 'Select at least one table'],
    },
  },
  SAVE_AS_VIEW: {
    NAME: {
      REQUIRED: ['请输入视图名称', 'Enter a view name'],
    },
  },
  MODELING_CREATE_MODEL: {
    TABLE: {
      REQUIRED: ['请选择一张表', 'Select a table'],
    },
    COLUMNS: {
      REQUIRED: ['请至少选择一列', 'Select at least one column'],
    },
    PRIMARY_KEY: {
      INVALID: [
        '主键必须是已选列之一，请重新选择',
        'The primary key must be one of the selected columns. Select it again.',
      ],
    },
  },
  CALCULATED_FIELD: {
    NAME: {
      REQUIRED: ['请输入字段名称', 'Enter a field name'],
    },
    EXPRESSION: {
      REQUIRED: ['请选择表达式', 'Select an expression'],
    },
    LINEAGE: {
      REQUIRED: ['请选择字段', 'Select a field'],
      INVALID_STRING_TYPE: ['请选择字符串类型的字段', 'Select a string field'],
      INVALID_NUMBER_TYPE: ['请选择数值类型的字段', 'Select a number field'],
    },
  },
  SQL_PAIR: {
    SQL: {
      REQUIRED: ['请输入 SQL 语句', 'Enter a SQL statement'],
    },
    QUESTION: {
      REQUIRED: ['请输入匹配的问题', 'Enter a matching question'],
      MAX_LENGTH: [
        '问题不能超过 300 个字符',
        'The question must be 300 characters or fewer',
      ],
    },
  },
  INSTRUCTION: {
    DETAILS: {
      REQUIRED: ['请输入指令内容', 'Enter the instruction details'],
    },
    QUESTIONS: {
      REQUIRED: ['请输入匹配的问题', 'Enter a matching question'],
    },
    IS_DEFAULT_GLOBAL: {
      REQUIRED: [
        '请选择指令的适用范围',
        'Choose how to apply this instruction',
      ],
    },
  },
  FIX_SQL: {
    SQL: {
      REQUIRED: ['请输入 SQL 语句', 'Enter a SQL statement'],
    },
  },
  ADJUST_REASONING: {
    SELECTED_MODELS: {
      REQUIRED: ['请至少选择一个模型', 'Select at least one model'],
    },
    STEPS: {
      REQUIRED: ['请输入推理步骤', 'Enter the reasoning steps'],
      MAX_LENGTH: [
        '推理步骤不能超过 6000 个字符',
        'Reasoning steps must be 6000 characters or fewer',
      ],
    },
  },
  IMPORT_DATA_SOURCE_SQL: {
    SQL: {
      REQUIRED: ['请输入 SQL 语句', 'Enter a SQL statement'],
    },
  },
  CRON: {
    REQUIRED: ['请输入 Cron 表达式', 'Enter a cron expression'],
    INVALID: ['Cron 表达式无效', 'Invalid cron expression'],
  },
  CACHE_SETTINGS: {
    DAY: {
      REQUIRED: ['请选择日期', 'Select a day'],
    },
    TIME: {
      REQUIRED: ['请选择时间', 'Select a time'],
    },
  },
} as const;

export const ERROR_TEXTS = localize(texts);
