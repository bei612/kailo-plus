-- 真实映射或墓碑引用存在时停止回滚，不能把已发生的外部副作用变成无引用。
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM projection.openmeter_binding) THEN
        RAISE EXCEPTION '存在 OpenMeter Customer 引用，禁止回滚此迁移';
    END IF;
END $$;
DROP TABLE projection.openmeter_binding;
