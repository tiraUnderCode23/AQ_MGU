# تغطية تطبيقات AQxheaTool2 وفصل ID7 / ID8

التاريخ: **19 نوفمبر 2026**. هذه مقارنة ملفات المصدر والتقارير فقط. لم يحدث اتصال بوحدة أو تثبيت أو بناء في هذا التدقيق.

## النتيجة

تجمع واجهة MGU الحالية **30 معرف تطبيق** من كتالوج iDrive، وApp Studio ذي 25 تطبيقاً، وحزم AQ، ومسار Store/Waze. كان **17 معرفاً** موجوداً في كتالوج AQ_MGU الأساسي، و**13 معرفاً ناقصاً**. الأساس المقارن هو commit `f424cf4e0e1844b23e5f5bcf9ce40b22b8ed6cfe` الذي يحوي 61 مكوناً. الأرقام تصف الوضع قبل إصلاحات هذه الجولة؛ لا تعني أن كل تطبيق جرى بناؤه أو تثبيته.

المرجع الآلي: [aq-app-coverage.json](../data/aq-app-coverage.json). يسجل كل معرف، وكل إصدار محلي مختلف، ومراجع الأدلة، ووجوده في الكتالوج الأساسي، ومتطلبات معروفة، وحدود الترخيص والتوافق. هو **ملف جرد** ولا يضاف إلى Store كمصدر تثبيت.

### نتيجة التنفيذ بعد المقارنة

أصبح **25 من معرفات AQ الثلاثين** موجوداً في فهرسي AQ_MGU. أضيفت ألعاب `aurelm_*` الثماني عبر روابط حزم الناشر الأصلي، مع فحص البايتات الكاملة وSHA256 وبنية الأرشيف. بقيت المعرفات الخمسة `aa_cluster_companion` و`aq_flap` و`aq_lights` و`bimmer_blocks` و`vehicle_pass` خارج فهرس التثبيت للأسباب المحددة أدناه؛ لم يُعامل مجرد جردها كإتمام إضافتها.

يسجل الحقل `integration_after_audit` النتيجة الحالية لكل تطبيق إلى جانب بيانات الأساس التاريخية. التفاصيل الأوسع في [تقرير الإصلاح](REPOSITORY_REPAIR_20261119_AR.md)، وسجل الأدلة لكل مكوّن في [install-readiness-20261119.json](../data/install-readiness-20261119.json). جميع نتائج التثبيت على وحدة حية تبقى `NOT OBSERVED`.

## ما كانت الواجهة تجمعه فعلاً

المرجع الحاسم هو `AQxheaTool2/lib/features/mgu/widgets/mgu_customer_workspace.dart:5846–5906`: يدمج قائمة المصدر الحالي، ثم App Studio، ثم حزم AQ، مع إزالة تكرار المعرف. مستوردات المستخدم الخاصة تأتي بعد ذلك في مساحة أسماء مستقلة؛ ليست تطبيقات عامة يحق إعادة نشرها تلقائياً.

| معرف التطبيق | إصدارات AQ المحلية المرصودة بحسب الكتالوج | إصدار AQ_MGU الأساسي |
|---|---|---|
| `aa_cluster_companion` | app_studio_25: 0.3.3<br>idrive_source_inventory: 0.3.3 | غير موجود |
| `ambient_config` | idrive_source_inventory: 2.0.4 | 2.6.2 |
| `aq_flap` | bundled_aq: 2.6.1 | غير موجود |
| `aq_lights` | bundled_aq: 4.6.0 | غير موجود |
| `aurelm_apex_chase` | app_studio_25: 1.0.0 | غير موجود |
| `aurelm_blackjack` | app_studio_25: 1.0.1 | غير موجود |
| `aurelm_lucky_sevens` | app_studio_25: 1.1.0 | غير موجود |
| `aurelm_pit_wall` | app_studio_25: 1.0.0 | غير موجود |
| `aurelm_snake` | app_studio_25: 1.0.0 | غير موجود |
| `aurelm_solitaire` | app_studio_25: 1.0.0 | غير موجود |
| `aurelm_street_siege` | app_studio_25: 1.0.0 | غير موجود |
| `aurelm_track_defender` | app_studio_25: 1.0.0 | غير موجود |
| `bimmer_blocks` | app_studio_25: 1.1.0 | غير موجود |
| `brake_test` | app_studio_25: 1.5.16<br>idrive_source_inventory: 1.5.20<br>legacy_11: 1.3.1 | 1.5.21 |
| `car_vitals` | app_studio_25: 2.23.0<br>idrive_source_inventory: 2.27.1<br>legacy_11: 2.12.2 | 2.27.6 |
| `doom` | app_studio_25: 1.7.16<br>idrive_source_inventory: 1.7.20<br>legacy_11: 1.4.0 | 1.7.22 |
| `draggy` | app_studio_25: 2.5.16<br>idrive_source_inventory: 2.5.20<br>legacy_11: 2.3.1 | 2.6.0 |
| `dtc_scanner` | app_studio_25: 2.9.4<br>idrive_source_inventory: 2.9.7<br>legacy_11: 2.6.3 | 2.9.8 |
| `dyno` | app_studio_25: 1.5.0<br>idrive_source_inventory: 1.6.1<br>legacy_11: 1.2.4 | 1.6.3 |
| `edrive` | app_studio_25: 2.7.3<br>idrive_source_inventory: 2.8.5<br>legacy_11: 1.9.4 | 2.10.1 |
| `gforce` | app_studio_25: 1.6.17<br>idrive_source_inventory: 1.6.21<br>legacy_11: 1.4.1 | 1.6.22 |
| `live_adjustments` | app_studio_25: 0.7.7<br>idrive_source_inventory: 0.9.3 | 0.9.8 |
| `live_data` | app_studio_25: 1.0.2<br>idrive_source_inventory: 1.0.10 | 1.0.16 |
| `redline` | app_studio_25: 1.11.0<br>idrive_source_inventory: 2.0.20<br>legacy_11: 1.8.1 | 2.0.44 |
| `robertn_store` | bundled_store_waze: 0.9.16 | 0.9.40 |
| `robertn_waze_cluster` | idrive_source_inventory: 0.4.0<br>bundled_store_waze: 0.4.1 | 0.6.12 |
| `service` | app_studio_25: 1.4.18<br>idrive_source_inventory: 1.6.1<br>legacy_11: 1.1.1 | 1.6.2 |
| `vehicle_pass` | app_studio_25: 1.1.0 | غير موجود |
| `warmup` | app_studio_25: 1.7.0<br>idrive_source_inventory: 1.7.4<br>legacy_11: 1.4.4 | 1.9.0 |
| `zf8hp` | app_studio_25: 1.5.2<br>idrive_source_inventory: 1.5.6 | 1.5.7 |

اختلاف الإصدار المحلي عن إصدار AQ_MGU ليس خطأ تلقائياً. بعض قوائم AQ مثبتة على مراجعات أقدم لأغراض التحقق. يجب اختيار مصدر وإصدار معروفين لكل تطبيق، وإبقاء أصل النسخة موثقاً.

## التطبيقات الثلاثة عشر التي غابت عن الأساس

- `aa_cluster_companion`: موجود في App Studio بالإصدار 0.3.3، لكنه محذوف من قائمة تطبيقات مراجعة iDrive الأحدث المستخدمة محلياً. ملفه الأصلي يذكر GPL-3.0-or-later، ويتطلب `aa-on-cluster >= 0.5.0` من المشروع الأصلي. وجود شاشة التطبيق لا يعني وجود خدمة عرض الخريطة. المرجع: `projects/apps/apps/aa_cluster_companion/README.md:7–19` داخل App Studio؛ و`idrive_apps_catalog.dart:289–325`.
- ألعاب `aurelm_*` الثماني: موجودة في App Studio، ومصدرها المسجل أرشيف `bmw-games` عند commit `c87a6c55bad7bcd1dc1879ca5676a7214b1e6fe0`. المسار المناسب عند توفر كتالوج أصلي سليم هو الإشارة إلى **تحميل الناشر الأصلي** مع حجمه وSHA الفعليين. هذا يختلف عن نسخ الملف أو المصدر إلى AQ_MGU. ترخيص MIT الخاص بالـkit لا يمتد تلقائياً إلى منطق الألعاب؛ ملف README المحلي لا يتضمن تصريح إعادة توزيع صريحاً عاماً.
- `bimmer_blocks` و`vehicle_pass`: مصدران مخصصان ضمن App Studio المحلي. يلزم حفظ مصدرهما الفعلي وملاحظاتهما بدلاً من اختراع رابط GitHub. `vehicle_pass/NOTICE` يحدد خط DejaVu إضافياً، وملف LICENSE هناك ترخيص للخط؛ يبقى إشعار المشروع وأصل كود التطبيق مستقلين.
- `aq_flap` و`aq_lights`: ملفات `source/package.json` الأصلية تعلن **UNLICENSED**. الحزم المحلية تتضمن donor SDK. يسجل الجرد الاسمين والإصدارين، لكنه لا يمنح إذناً بإعادة نشر الحزمة أو المصدر. يلزم مصدر مستقل يسمح نشره وخالٍ من SDK قبل إدراجه كحزمة عامة. تحديث واجهة AQ Lights المنفصل لا يحول الحزمة الأصلية كلها إلى كود مرخص للنشر.

أصل App Studio متاح محلياً تحت الجذر المعتمد `/ma-coding/MGU-App-Studio-2.4.0`. يشير `THIRD-PARTY.txt:5–9` إلى المصادر المستخدمة. بيان `assets/aq_runtime/mgu_app_studio_25_source.manifest.json` يسجل 426 ملف مصدر، و`sdkBundled=false`، و`id8Qualified=false`. لا ينبغي استخدام الأرشيف المحمي أو حزم التطبيقات الأصلية بديلاً عن مراجعة ملفات المصدر المطلوبة.

## فروق المسارات والقبول بين ID7 وID8

المرجع هو نسخة Store الأصلية الموجودة في `AQxheaTool2/.agents/Sec/MGU/idrive7-apps-main/mgu-store-main/deploy/README.md:382–440,488–539`. هذه أدلة على عقد المثبت؛ لا تعني أن مسارات وحدة حية فُحصت في هذه الجولة.

| العنصر | ID7 | ID8 |
|---|---|---|
| مجلد مدير التطبيقات | `/usr/lib/oap-mainapp` | `/usr/lib/oap-mainapp21` |
| اسم HMI المميز | `HmiMain3D` | `Hmi8` |
| الحزم المسجلة للمنصة | `/usr/lib/oap-mainapp/preinstalled_apps` | `/usr/lib/oap-mainapp21/preinstalled_apps` |
| حالة التثبيت المؤجلة | حسب عقد نسخة المثبت | `/var/opt/mgu-deploy/id8/pending.json` |
| طابور الحزم | حسب عقد نسخة المثبت | `/var/opt/mgu-deploy/id8/queue` |
| نتيجة تطبيق الطابور | حسب عقد نسخة المثبت | `/var/opt/mgu-deploy/id8/last-apply.json` |
| سجل كل تطبيق | `/var/opt/public/oap/oap_<manager_uid>/data/apps/<id>.json` | نفس نمط السجل، مع دورة MainApp-21 |
| موطن التطبيق | `/var/opt/public/oap/oap_<uid>` | UID يخصصه مدير المنصة، ولا ينسخ من مثال |

عند وجود المجلدين أو غيابهما، يذكر المصدر الأصلي أن HMI الجاري يساعد في تحديد العائلة. ينبغي ألا يتحول الغموض إلى افتراض ID7 أو ID8.

القيمة الافتراضية لـ`manager_uid` هي `12201`، لكنها قابلة للضبط في المثبت الأصلي عبر `MGU_DEPLOY_MAINAPP_UID`؛ لا تُثبت في مسار عام لكل وحدة.

كل مكون يحتاج `mguHmi` مناسباً، وواجهة RHMI متوافقة ومتطلبات تعمل على العائلة نفسها. إعلان المستودع إجمالاً ID7 وID8 صحيح فقط بوصفه اتحاد دعم مكوناته. لا يجعل كل تطبيق ثنائي الدعم. وبالمثل، دعم renderer للعائلتين لا يمنح تطبيق ID7 دعماً لـID8.

توضح خطة AQ `mgu_id8_apps_source_plan.dart:90–124` ضرورة إعلان ID8 صراحةً ومعرفة MainApp-21 والسجل الصحيح. أما `mgu_app_studio_catalog.dart:38–40` فيعلن أن مجموعة Studio هي ID7، وأن `id8Qualified=false`.

## ما يجب أخذه من تقرير ID8 بحذر

التقرير `docs/mgu/MGU_ID8_FLASH_SSH_INSTALL_MECHANISM_20261111_AR.md:39–71` يصف هدف Hmi8 واحداً، وشاشة 2880×960، ونسخة SDK، ونجاحاً تاريخياً لمنفذ AQ Lights. يوضح أن مسار Store يعيد تجهيز الحزمة بالشكل الذي يتطلبه MainApp-21، وأن المثبت القديم أعطى tile بديلة مع مشكلة تخصيص UID.

هذه القيم لا تصلح ثوابت عامة:

- مسار donor `oap_12204` هو موضع شوهد على هدف واحد؛ يجب اكتشاف مصدر SDK الصحيح من الوحدة المستهدفة.
- قيمة appletId `20100` مثال تاريخي. المصدر الأصلي يختار المعرف أو يحافظ عليه بناءً على المعرفات المستخدمة؛ إعادة الرقم لكل التطبيقات تسبب تصادماً.
- لا تكفي إضافة واجهات تنتهي بالرقم 2 إلى manifest لكي يصبح أي تطبيق ID7 صالحاً لـID8؛ البناء والواجهات والاعتمادات يجب أن تتوافق مع المصدر والعائلة.
- نجاح AQ Lights المذكور في تقرير قديم لا يثبت أن أرشيف ID7 المحزم في AQxheaTool2 هو المنفذ نفسه، ولا أن التطبيقات الأخرى ثبتت.

توجد عبارة أقدم متعارضة في `idrive_modern_kit_inventory.dart:237–245` توجه AQ بصيغة .mgu إلى المسار القديم وتقول إن mgu-deploy ليس مساره. التقرير الأحدث يصف قبول .mgu عبر Store على ID8. لذلك لا تُنسخ العبارة القديمة كتعميم للمستودع؛ المرجع النهائي هو عقد نسخة المثبت الأصلية وشكل الحزمة والعائلة الفعليان.

## دور تقارير NBT

المجلد الذي ذكره المستخدم `.agents/Sec/nbt/nbt apps` مهم لفهم التطبيقات والأخطاء. README فيه يوضح أن محتواه **19 منفذاً أصلياً لـNBT EVO ID5/ID6 على QNX/ARM**. الأسماء مشتركة مع تطبيقات MGU، لكن الحزم وABI وواجهات HMI مختلفة. يستفاد منه للجرد ومنهج التحقق؛ لا تنقل ملفات NBT التنفيذية إلى مصدر MGU، ولا يصنف نجاح منفذ NBT دليلاً على دعم ID8.

## معيار إتمام التصحيح

1. يغطي الجرد جميع معرفات واجهة AQ الثلاثين، ويحفظ السبب إذا تعذر النشر أو غاب متطلب أصلي.
2. يشير كل تحميل إلى ملف ناشر أصلي أو مصدر تسمح شروطه بالنشر، مع حجم وSHA محسوبين من الملف المقصود.
3. يظل دعم العائلة خاصاً بكل تطبيق وكل اعتماد، ويُرفض افتراض التوافق بمجرد وجود الاسم.
4. يتولى Store/deploy الأصلي دورة التثبيت والمسارات وUID. تعتبر حالة `pending_reboot` انتظاراً، وتحتاج النتيجة سجل التطبيق وحالته الفعلية.
5. تفصل نتائج فحوص الكتالوج والبناء عن قبول الوحدة. نتيجة التثبيت الحي لكل تطبيق في جرد هذه الجولة هي `NOT_OBSERVED`.

لم تُعدل نسخة AQxheaTool2 أو مصادرها. أُنشئ ملفا التقرير والجرد في نسخة AQ_MGU المخصصة للإصلاحات، وبقي مجلد سطح المكتب المرفوض من الموصل دون قراءة أو تعديل.

