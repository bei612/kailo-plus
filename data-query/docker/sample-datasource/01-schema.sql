-- DD-129: Wren 问数验收用的示例业务库（门店零售）。只由属主角色在首次初始化时建立；
-- Wren 只拿到 03-reader.sh 建立的只读角色。表与列注释供原生建模与问数理解业务含义。
CREATE TABLE regions (
  region_id   smallint PRIMARY KEY,
  region_name text NOT NULL UNIQUE
);
COMMENT ON TABLE regions IS '销售大区';
COMMENT ON COLUMN regions.region_name IS '大区名称';

CREATE TABLE stores (
  store_id    smallint PRIMARY KEY,
  store_name  text NOT NULL UNIQUE,
  city        text NOT NULL,
  region_id   smallint NOT NULL REFERENCES regions(region_id),
  store_type  text NOT NULL CHECK (store_type IN ('旗舰店','标准店','社区店')),
  opened_on   date NOT NULL,
  area_sqm    integer NOT NULL CHECK (area_sqm > 0)
);
COMMENT ON TABLE stores IS '门店';
COMMENT ON COLUMN stores.store_name IS '门店名称';
COMMENT ON COLUMN stores.city IS '所在城市';
COMMENT ON COLUMN stores.store_type IS '门店类型：旗舰店、标准店、社区店';
COMMENT ON COLUMN stores.opened_on IS '开业日期';
COMMENT ON COLUMN stores.area_sqm IS '营业面积（平方米）';

CREATE TABLE products (
  product_id   smallint PRIMARY KEY,
  product_name text NOT NULL UNIQUE,
  category     text NOT NULL,
  brand        text NOT NULL,
  unit_price   numeric(10,2) NOT NULL CHECK (unit_price > 0),
  unit_cost    numeric(10,2) NOT NULL CHECK (unit_cost > 0 AND unit_cost < unit_price)
);
COMMENT ON TABLE products IS '商品';
COMMENT ON COLUMN products.category IS '商品品类';
COMMENT ON COLUMN products.unit_price IS '标价（元）';
COMMENT ON COLUMN products.unit_cost IS '进货成本（元）';

CREATE TABLE customers (
  customer_id   integer PRIMARY KEY,
  customer_name text NOT NULL,
  gender        text NOT NULL CHECK (gender IN ('男','女')),
  birth_year    smallint NOT NULL,
  city          text NOT NULL,
  member_level  text NOT NULL CHECK (member_level IN ('普通','银卡','金卡','铂金')),
  registered_on date NOT NULL
);
COMMENT ON TABLE customers IS '会员客户';
COMMENT ON COLUMN customers.member_level IS '会员等级：普通、银卡、金卡、铂金';
COMMENT ON COLUMN customers.registered_on IS '注册日期';

CREATE TABLE orders (
  order_id        integer PRIMARY KEY,
  customer_id     integer NOT NULL REFERENCES customers(customer_id),
  store_id        smallint NOT NULL REFERENCES stores(store_id),
  order_date      date NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('门店','小程序','外卖平台')),
  payment_method  text NOT NULL CHECK (payment_method IN ('微信支付','支付宝','银行卡','现金')),
  status          text NOT NULL CHECK (status IN ('已完成','已退款')),
  total_amount    numeric(12,2) NOT NULL DEFAULT 0
);
COMMENT ON TABLE orders IS '订单';
COMMENT ON COLUMN orders.order_date IS '下单日期';
COMMENT ON COLUMN orders.channel IS '下单渠道：门店、小程序、外卖平台';
COMMENT ON COLUMN orders.status IS '订单状态：已完成、已退款（已退款订单不计入销售额）';
COMMENT ON COLUMN orders.total_amount IS '订单实付金额（元），等于明细实付金额之和';

CREATE TABLE order_items (
  order_id        integer NOT NULL REFERENCES orders(order_id),
  line_no         smallint NOT NULL,
  product_id      smallint NOT NULL REFERENCES products(product_id),
  quantity        smallint NOT NULL CHECK (quantity > 0),
  unit_price      numeric(10,2) NOT NULL,
  discount_amount numeric(10,2) NOT NULL DEFAULT 0,
  paid_amount     numeric(12,2) NOT NULL,
  PRIMARY KEY (order_id, line_no)
);
COMMENT ON TABLE order_items IS '订单明细';
COMMENT ON COLUMN order_items.unit_price IS '成交单价（元）';
COMMENT ON COLUMN order_items.discount_amount IS '会员折扣金额（元）';
COMMENT ON COLUMN order_items.paid_amount IS '明细实付金额（元）= 单价×数量−折扣';

CREATE INDEX orders_order_date ON orders(order_date);
CREATE INDEX orders_store ON orders(store_id);
CREATE INDEX orders_customer ON orders(customer_id);
CREATE INDEX order_items_product ON order_items(product_id);
