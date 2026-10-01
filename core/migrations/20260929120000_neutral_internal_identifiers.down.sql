-- 回退到以旧 audience 查找部署引导主体的版本。target ID 派生规则随代码回退，
-- 回退同样只应在没有在途角色动作时进行（见 up 的说明）。
UPDATE identity.service_principal
   SET audience = 'kailo-deployment-bootstrap'
 WHERE audience = 'platform-deployment-bootstrap';
