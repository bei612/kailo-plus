-- DD-129: 固定、可复核的示例业务数据。只用 md5 派生的伪随机数（不依赖 random()
-- 的执行顺序），同一脚本在任一 PostgreSQL 16 上得到完全相同的行。
CREATE FUNCTION pg_temp.r(seed text) RETURNS double precision LANGUAGE sql IMMUTABLE AS
$$ SELECT ('x' || substr(md5(seed), 1, 12))::bit(48)::bigint / 281474976710656.0 $$;

INSERT INTO regions VALUES (1,'华东'),(2,'华北'),(3,'华南'),(4,'华中'),(5,'西南');

INSERT INTO stores VALUES
 (1,'上海徐汇店','上海',1,'旗舰店','2019-04-28',1200),
 (2,'上海浦东店','上海',1,'标准店','2020-09-12',800),
 (3,'杭州西湖店','杭州',1,'标准店','2021-03-06',760),
 (4,'南京新街口店','南京',1,'标准店','2021-11-20',720),
 (5,'苏州园区店','苏州',1,'社区店','2023-05-18',380),
 (6,'北京朝阳店','北京',2,'旗舰店','2019-08-08',1150),
 (7,'北京海淀店','北京',2,'标准店','2022-01-15',820),
 (8,'天津滨海店','天津',2,'社区店','2023-09-01',360),
 (9,'石家庄中山店','石家庄',2,'社区店','2024-04-26',340),
 (10,'广州天河店','广州',3,'旗舰店','2020-05-01',1100),
 (11,'深圳南山店','深圳',3,'标准店','2020-12-12',860),
 (12,'厦门思明店','厦门',3,'社区店','2024-06-18',320),
 (13,'武汉光谷店','武汉',4,'标准店','2021-06-01',780),
 (14,'长沙五一店','长沙',4,'标准店','2022-07-16',700),
 (15,'郑州二七店','郑州',4,'社区店','2024-10-01',350),
 (16,'成都春熙店','成都',5,'旗舰店','2020-10-01',1050),
 (17,'重庆解放碑店','重庆',5,'标准店','2022-04-30',740),
 (18,'昆明翠湖店','昆明',5,'社区店','2025-03-08',330);

INSERT INTO products VALUES
 (1,'东方树叶茉莉花茶500ml','饮料','农夫山泉',5.50,3.10),
 (2,'元气森林白桃气泡水480ml','饮料','元气森林',5.00,2.60),
 (3,'特仑苏纯牛奶250ml×12','饮料','蒙牛',69.90,48.00),
 (4,'三得利乌龙茶500ml','饮料','三得利',5.50,3.20),
 (5,'瑞幸生椰拿铁罐装','饮料','瑞幸',7.90,4.60),
 (6,'三只松鼠每日坚果750g','休闲零食','三只松鼠',99.00,62.00),
 (7,'良品铺子猪肉脯200g','休闲零食','良品铺子',32.80,19.50),
 (8,'卫龙大面筋106g','休闲零食','卫龙',6.50,3.40),
 (9,'旺旺雪饼520g','休闲零食','旺旺',22.90,13.80),
 (10,'奥利奥夹心饼干388g','休闲零食','亿滋',18.90,11.20),
 (11,'金龙鱼调和油5L','粮油调味','金龙鱼',69.90,52.00),
 (12,'五常大米5kg','粮油调味','柴火大院',79.00,55.00),
 (13,'海天生抽1.9L','粮油调味','海天',19.90,12.30),
 (14,'太太乐鸡精200g','粮油调味','太太乐',9.90,5.80),
 (15,'李锦记蚝油510g','粮油调味','李锦记',12.90,7.60),
 (16,'海南金煌芒果2.5kg','生鲜果蔬','产地直采',49.90,31.00),
 (17,'智利车厘子J级1kg','生鲜果蔬','产地直采',129.00,92.00),
 (18,'有机西兰花500g','生鲜果蔬','本地农场',12.80,7.20),
 (19,'农场散养鸡蛋30枚','生鲜果蔬','本地农场',36.90,24.00),
 (20,'冷鲜三黄鸡1.2kg','生鲜果蔬','温氏',45.90,31.50),
 (21,'蓝月亮洗衣液3kg','日用清洁','蓝月亮',59.90,36.00),
 (22,'维达抽纸3层100抽×24','日用清洁','维达',49.90,32.00),
 (23,'立白洗洁精1.5kg','日用清洁','立白',15.90,9.10),
 (24,'威猛先生厨房清洁剂','日用清洁','庄臣',24.90,14.60),
 (25,'舒肤佳沐浴露1L','个护美妆','宝洁',45.90,27.50),
 (26,'云南白药牙膏180g','个护美妆','云南白药',32.90,19.80),
 (27,'海飞丝洗发水750ml','个护美妆','宝洁',69.90,42.00),
 (28,'百雀羚水乳套装','个护美妆','百雀羚',199.00,118.00),
 (29,'花王纸尿裤L码54片','母婴','花王',139.00,96.00),
 (30,'飞鹤星飞帆3段700g','母婴','飞鹤',268.00,186.00),
 (31,'贝亲婴儿湿巾80抽×3','母婴','贝亲',39.90,24.50),
 (32,'乐扣保鲜盒四件套','家居百货','乐扣乐扣',89.00,52.00),
 (33,'苏泊尔不粘炒锅30cm','家居百货','苏泊尔',199.00,128.00),
 (34,'得力A4复印纸500张','家居百货','得力',29.90,18.50),
 (35,'小米台灯Pro','家居百货','小米',169.00,112.00),
 (36,'农夫山泉饮用水550ml×24','饮料','农夫山泉',29.90,19.20),
 (37,'德芙丝滑牛奶巧克力252g','休闲零食','玛氏',39.90,24.80),
 (38,'鲁花花生油5L','粮油调味','鲁花',139.00,103.00),
 (39,'阳光玫瑰葡萄1kg','生鲜果蔬','产地直采',59.90,38.00),
 (40,'全棉时代洗脸巾100抽','个护美妆','全棉时代',29.90,17.60);

-- 3000 名会员：城市取门店所在城市，注册日期 2019-05 至 2026-08。
INSERT INTO customers
SELECT i,
       (ARRAY['王','李','张','刘','陈','杨','黄','赵','吴','周','徐','孙','马','朱','胡','郭','何','林','罗','高'])
         [1 + floor(pg_temp.r('surname' || i) * 20)::int]
       || (ARRAY['伟','芳','娜','敏','静','丽','强','磊','军','洋','勇','艳','杰','娟','涛','明','超','秀英','霞','平',
                 '刚','桂英','浩然','子涵','欣怡','宇轩','梓萱','一诺','思远','嘉怡'])
         [1 + floor(pg_temp.r('given' || i) * 30)::int],
       CASE WHEN pg_temp.r('gender' || i) < 0.52 THEN '女' ELSE '男' END,
       1958 + floor(pg_temp.r('birth' || i) * 48)::int,
       s.city,
       CASE WHEN pg_temp.r('level' || i) < 0.55 THEN '普通'
            WHEN pg_temp.r('level' || i) < 0.80 THEN '银卡'
            WHEN pg_temp.r('level' || i) < 0.95 THEN '金卡' ELSE '铂金' END,
       date '2019-05-01' + floor(pg_temp.r('registered' || i) * 2650)::int
FROM generate_series(1, 3000) AS i
JOIN stores s ON s.store_id = 1 + floor(pg_temp.r('home' || i) * 18)::int;

-- 36000 张订单，2025-01-01 至 2026-09-30，后期增长；门店不早于开业日期。
INSERT INTO orders(order_id, customer_id, store_id, order_date, channel, payment_method, status)
SELECT i, c, st,
       greatest(d, (SELECT opened_on FROM stores WHERE store_id = st)),
       CASE WHEN pg_temp.r('channel' || i) < 0.58 THEN '门店'
            WHEN pg_temp.r('channel' || i) < 0.84 THEN '小程序' ELSE '外卖平台' END,
       CASE WHEN pg_temp.r('pay' || i) < 0.52 THEN '微信支付'
            WHEN pg_temp.r('pay' || i) < 0.86 THEN '支付宝'
            WHEN pg_temp.r('pay' || i) < 0.96 THEN '银行卡' ELSE '现金' END,
       CASE WHEN pg_temp.r('refund' || i) < 0.04 THEN '已退款' ELSE '已完成' END
FROM generate_series(1, 36000) AS i,
     LATERAL (SELECT 1 + floor(pg_temp.r('customer' || i) * 3000)::int AS c,
                     1 + floor(power(pg_temp.r('store' || i), 1.15) * 18)::int AS st,
                     date '2025-01-01' + floor(sqrt(pg_temp.r('day' || i)) * 638)::int AS d) AS pick;

-- 每单 1–4 行明细；生鲜与饮料更常见，金卡/铂金会员享 5%/10% 折扣。
INSERT INTO order_items(order_id, line_no, product_id, quantity, unit_price, discount_amount, paid_amount)
SELECT o.order_id, line.n, p.product_id, q.quantity, p.unit_price,
       round(p.unit_price * q.quantity * rate.discount, 2),
       round(p.unit_price * q.quantity * (1 - rate.discount), 2)
FROM orders o
JOIN customers cu ON cu.customer_id = o.customer_id
CROSS JOIN LATERAL generate_series(1, 1 + floor(pg_temp.r('lines' || o.order_id) * 4)::int) AS line(n)
CROSS JOIN LATERAL (SELECT 1 + floor(power(pg_temp.r('product' || o.order_id || ':' || line.n), 1.3) * 40)::int AS id) AS pick
JOIN products p ON p.product_id = pick.id
CROSS JOIN LATERAL (SELECT 1 + floor(pg_temp.r('qty' || o.order_id || ':' || line.n) * 3)::int AS quantity) AS q
CROSS JOIN LATERAL (SELECT CASE cu.member_level WHEN '铂金' THEN 0.10 WHEN '金卡' THEN 0.05 ELSE 0 END AS discount) AS rate
ON CONFLICT DO NOTHING;

UPDATE orders o SET total_amount = t.amount
FROM (SELECT order_id, sum(paid_amount) AS amount FROM order_items GROUP BY order_id) t
WHERE t.order_id = o.order_id;

ANALYZE;
