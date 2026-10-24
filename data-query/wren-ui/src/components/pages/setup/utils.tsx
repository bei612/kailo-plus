import { merge } from 'lodash';
import { IconComponentProps } from '@/import/icon';
import { SETUP, DATA_SOURCES } from '@/utils/enum';
import Starter from './Starter';
import ConnectDataSource from './ConnectDataSource';
import SelectModels from './SelectModels';
import DefineRelations from './DefineRelations';
import { ERROR_CODES } from '@/utils/errorHandler';
import type { KailoTextKey } from '@/utils/kailoI18n';
import {
  getDataSourceConfig,
  getDataSourceFormComponent,
} from '@/utils/dataSourceType';

type SetupStep = {
  step: number;
  component: (
    props?: React.ComponentProps<typeof Starter> &
      React.ComponentProps<typeof ConnectDataSource> &
      React.ComponentProps<typeof SelectModels> &
      React.ComponentProps<typeof DefineRelations>,
  ) => JSX.Element;
  maxWidth?: number;
};

// DD-152: the onboarding step titles (Kailo page header and the stepper).
export const SETUP_STEP_TITLES: KailoTextKey[] = [
  'setup.stepConnect',
  'setup.stepSelectTables',
  'setup.stepDefineRelations',
];

export type ButtonOption = {
  label: string;
  logo?: string;
  IconComponent?: IconComponentProps['component'];
  guide?: string;
  disabled?: boolean;
  submitting?: boolean;
  value?: string;
};

export const SETUP_STEPS = {
  [SETUP.STARTER]: {
    step: 0,
    component: Starter,
  },
  [SETUP.CREATE_DATA_SOURCE]: {
    step: 0,
    component: ConnectDataSource,
    maxWidth: 960,
  },
  [SETUP.SELECT_MODELS]: {
    step: 1,
    component: SelectModels,
    maxWidth: 960,
  },
  [SETUP.DEFINE_RELATIONS]: {
    step: 2,
    component: DefineRelations,
  },
} as { [key: string]: SetupStep };

export const DATA_SOURCE_OPTIONS = {
  [DATA_SOURCES.BIG_QUERY]: {
    ...getDataSourceConfig(DATA_SOURCES.BIG_QUERY),
    disabled: false,
  },
  [DATA_SOURCES.DUCKDB]: {
    ...getDataSourceConfig(DATA_SOURCES.DUCKDB),
    disabled: false,
  },
  [DATA_SOURCES.POSTGRES]: {
    ...getDataSourceConfig(DATA_SOURCES.POSTGRES),
    disabled: false,
  },
  [DATA_SOURCES.MYSQL]: {
    ...getDataSourceConfig(DATA_SOURCES.MYSQL),
    disabled: false,
  },
  [DATA_SOURCES.ORACLE]: {
    ...getDataSourceConfig(DATA_SOURCES.ORACLE),
    disabled: false,
  },
  [DATA_SOURCES.MSSQL]: {
    ...getDataSourceConfig(DATA_SOURCES.MSSQL),
    disabled: false,
  },
  [DATA_SOURCES.CLICK_HOUSE]: {
    ...getDataSourceConfig(DATA_SOURCES.CLICK_HOUSE),
    disabled: false,
  },
  [DATA_SOURCES.TRINO]: {
    ...getDataSourceConfig(DATA_SOURCES.TRINO),
    disabled: false,
  },
  [DATA_SOURCES.SNOWFLAKE]: {
    ...getDataSourceConfig(DATA_SOURCES.SNOWFLAKE),
    disabled: false,
  },
  [DATA_SOURCES.ATHENA]: {
    ...getDataSourceConfig(DATA_SOURCES.ATHENA),
    disabled: false,
  },
  [DATA_SOURCES.REDSHIFT]: {
    ...getDataSourceConfig(DATA_SOURCES.REDSHIFT),
    disabled: false,
  },
  [DATA_SOURCES.DATABRICKS]: {
    ...getDataSourceConfig(DATA_SOURCES.DATABRICKS),
    disabled: false,
  },
} as { [key: string]: ButtonOption };

// DD-133 §1: the upstream sample datasets are downloaded from the vendor's
// hosts and documented on its site; the Kailo build offers none.
export const TEMPLATE_OPTIONS = {} as {
  [key: string]: { label: string; IconComponent: any; guide?: string };
};

export const getDataSources = () => {
  return Object.values(DATA_SOURCE_OPTIONS) as ButtonOption[];
};

export const getDataSource = (dataSource: DATA_SOURCES) => {
  return merge(
    DATA_SOURCE_OPTIONS[dataSource],
    getDataSourceFormComponent(dataSource),
  );
};

export const getTemplates = () => {
  return Object.keys(TEMPLATE_OPTIONS).map((key) => ({
    ...TEMPLATE_OPTIONS[key],
    value: key,
  })) as ButtonOption[];
};

export const getPostgresErrorMessage = (error: Record<string, any>) => {
  if (error.code === ERROR_CODES.CONNECTION_REFUSED) {
    return <div>{error.message}</div>;
  }
  return error.message;
};
