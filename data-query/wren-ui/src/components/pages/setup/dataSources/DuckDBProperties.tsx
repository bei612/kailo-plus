import Link from 'next/link';
import { Col, Form, Input, Button, Row } from 'antd';
import { ERROR_TEXTS } from '@/utils/error';
import DeleteOutlined from '@ant-design/icons/DeleteOutlined';
import PlusOutlined from '@ant-design/icons/PlusOutlined';
import { kailoT } from '@/utils/kailoI18n';

const { TextArea } = Input;

export default function DuckDBProperties() {
  return (
    <>
      <Form.Item
        label={kailoT('setup.fieldDisplayName')}
        name="displayName"
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.DISPLAY_NAME.REQUIRED,
          },
        ]}
      >
        <Input placeholder="DuckDB" />
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldInitSql')}
        name="initSql"
        extra={kailoT('setup.hintInitSql')}
        rules={[
          {
            required: true,
            message: ERROR_TEXTS.CONNECTION.INIT_SQL.REQUIRED,
          },
        ]}
      >
        <TextArea
          placeholder="CREATE TABLE new_tbl AS SELECT * FROM read_csv('input.csv');"
          rows={4}
        />
      </Form.Item>

      <Form.Item
        label={kailoT('setup.fieldConfigOptions')}
        extra={
          <>
            {kailoT('setup.hintDuckDbConfig')}{' '}
            <Link
              href="https://duckdb.org/docs/configuration/overview.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              {kailoT('setup.learnMore')}
            </Link>
          </>
        }
      >
        <Form.List name="configurations" initialValue={[{}]}>
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <Row key={key} wrap={false} gutter={8}>
                  <Col flex="1 0">
                    <Form.Item
                      {...restField}
                      name={[name, 'key']}
                      style={{ width: '100%' }}
                      rules={[
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (
                              getFieldValue(['configurations', name, 'value'])
                            ) {
                              if (!value) {
                                return Promise.reject(
                                  ERROR_TEXTS.CONNECTION.CONFIGURATION.KEY
                                    .REQUIRED,
                                );
                              }
                            }

                            return Promise.resolve();
                          },
                        }),
                      ]}
                    >
                      <Input placeholder={kailoT('setup.phKey')} />
                    </Form.Item>
                  </Col>
                  <Col flex="1 0">
                    <Form.Item
                      {...restField}
                      name={[name, 'value']}
                      style={{ width: '100%' }}
                      rules={[
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            if (
                              getFieldValue(['configurations', name, 'key'])
                            ) {
                              if (!value) {
                                return Promise.reject(
                                  ERROR_TEXTS.CONNECTION.CONFIGURATION.VALUE
                                    .REQUIRED,
                                );
                              }
                            }

                            return Promise.resolve();
                          },
                        }),
                      ]}
                    >
                      <Input placeholder={kailoT('setup.phValue')} />
                    </Form.Item>
                  </Col>
                  <Col flex="none" className="p-1">
                    <DeleteOutlined onClick={() => remove(name)} />
                  </Col>
                </Row>
              ))}
              <Form.Item noStyle>
                <Button
                  type="dashed"
                  onClick={() => add()}
                  block
                  icon={<PlusOutlined />}
                >
                  {kailoT('setup.addOption')}
                </Button>
              </Form.Item>
            </>
          )}
        </Form.List>
      </Form.Item>
      <Form.Item
        label={kailoT('setup.fieldExtensions')}
        extra={
          <>
            {kailoT('setup.hintDuckDbExtensions')}{' '}
            <Link
              href="https://duckdb.org/docs/extensions/overview.html"
              target="_blank"
              rel="noopener noreferrer"
            >
              {kailoT('setup.learnMore')}
            </Link>
          </>
        }
      >
        <Form.List name="extensions" initialValue={['']}>
          {(fields, { add, remove }) => (
            <>
              {fields.map(({ key, name, ...restField }) => (
                <Row key={key} wrap={false} gutter={8} className="my-2">
                  <Col flex="1 0">
                    <Form.Item
                      {...restField}
                      name={name}
                      noStyle
                      style={{ width: '100%' }}
                    >
                      <Input placeholder={kailoT('setup.phExtensionName')} />
                    </Form.Item>
                  </Col>
                  <Col flex="none" className="p-1">
                    <DeleteOutlined onClick={() => remove(name)} />
                  </Col>
                </Row>
              ))}
              <Form.Item noStyle>
                <Button
                  type="dashed"
                  onClick={() => add()}
                  block
                  icon={<PlusOutlined />}
                >
                  {kailoT('setup.addExtension')}
                </Button>
              </Form.Item>
            </>
          )}
        </Form.List>
      </Form.Item>
    </>
  );
}
