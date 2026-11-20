# أهلية ID8 وحفظ الجرد — 20 نوفمبر 2026

## النتيجة

الجرد مربوط بالالتزام **714b2edb37f1bac811444ead348509b2b2836745** ويحتفظ بـ**294 نسخة موزعة: 214 تطبيقًا و 80 أداة**، منها ست مراجع أدوات من IterioDev. بقاء العنصر في الجرد مستقل عن أهليته لـID8؛ لم تُحذف أصول أو تُعدّل فروع في هذا التدقيق.

يثبت السجل عقد توافق ساكن لـ**58 تطبيقًا و 17 أداة**. يختار مخطط ID8 **75 عنصرًا**، تشمل **6 مراجع أدوات خارجية**. يشمل الاختيار جميع العناصر المؤهلة، بما فيها الأداة الخارجية المستقلة iteriodev-screencast 1.0.9 مع مصدرها المثبت واعتمادياتها. لا تُضاف أي تطبيقات يقتصر تصريحها على ID7، وتبقى حالة التشغيل غير ملحوظة.

**eligible_static لا تعني جاهزية نشر غير مشروطة.** تعني هوية ثابتة، ودليل موارد ID8 أو عقد منصة أداة، وروابط اعتماديات توافق الحدود الدنيا. يجب أن تجتاز مداخل البناء الفعلية وبوابات المشروع مراجعتها المستقلة قبل النشر. **التحضير بـSDK حقيقي والتثبيت والتشغيل على HU: NOT_OBSERVED.** لا تستخدم نتائج الاختبارات التاريخية لتجاوز أعطال مداخل حالية.

لا يستطيع فرع ID8 وحده أن يحل محل الجرد الكامل؛ توجد عناصر يقتصر تصريحها الحالي على ID7. يبقى main مرجع الحفظ الشامل، وتُشتق توزيعة ID8 دون حذف الأصول غير المؤهلة.

## طريقة المراجعة وحدودها

قُرئت ملفات Git عند الالتزام المثبت. لكل نسخة هوية وإصدار وقناة مستقلة، وإحالات تضم المسار والالتزام وSHA-256. قُرئت بيانات المصدر والحزمة وربط RHMI ووصفات البناء والنص البرمجي ذي الصلة دون تنفيذه.

فُحصت **19 حزمة إصدار حالية وحزمتا prebuilt محليتان**. طابق الحجم الكامل وSHA-256 والهوية داخل الأرشيف القيم المعلنة. وتحقق ربط ID8 في ملف rhmiData/application.json بملفي XML وJSON الموجودين؛ فلا يستند الحكم إلى اسم مجلد. لم يُفك الأرشيف إلى شجرة تشغيل ولم يُنفّذ محتواه. البراهين الجديدة مضمّنة في JSON.

قُرئت بيانات الأدوات الخارجية الست من URLs الناشر المثبتة على **f9ca32bd3cebd163fa16fbe17cc3473623be2c81**. تطابقت الهوية والإصدار وHMI والاعتماديات مع المراجع المحلية. هي مراجع أصلية خارجية؛ لم تُحمّل حمولاتها التنفيذية أو تُعد استضافتها. أهلية المرجع تعني صحة عقده الساكن المثبت، وسلامة بايتات الأداة يجب أن تتحقق عند جلبها.

لم يُشغّل هذا التدقيق اختبارات المشروع أو مولّداته أو سكربتات upstream، ولم يتصل بسيارة أو HU أو ADB أو SSH. الفحص الساكن لا يثبت صلاحية كل إشارة مركبة أو واجهة تحكم، ولا صلاحية ABI على كل إصدار HU.

## الأعداد والمرجع التاريخي

| المرجع | مصدر: تطبيقات/أدوات | إصدار: تطبيقات/أدوات |
|---|---:|---:|
| canonical | 160/38 | 54/36 |
| main_before_restoration | 152/38 | 52/34 |
| id8_before | 44/5 | 12/2 |
| games_before | 8/4 | 12/4 |
| games_preservation | 9/11 | 13/11 |

تحتوي النسخة المرجعية على 198 صف مصدر و 90 صف إصدار وستة مراجع أدوات خارجية. قبل استعادة العناصر كان main@e799da0cbe2a8a9b9f7b0dfcd844a69b85cf7334 يحوي 190 مصدرًا و 86 إصدارًا. أرقام الشارات والتقارير القديمة ليست بديلًا عن الجرد المثبت.

فرع id8 التاريخي عند c1124f97c3598b70b4e1d377e8a78689a8ae4ccb يحوي 49 مصدرًا و 14 إصدارًا: 56 تطبيقًا و 7 أدوات محلية. وفرع games عند e10090293bb8f5350f5b9c8c46947670486f503a يحوي 12 مصدرًا و 16 إصدارًا. يحفظ JSON عضوية النسخ عند هذه الالتزامات وأي نسخة تاريخية غير ممثلة. لم تُنقل رؤوس الفروع.

## الفصل بين مراحل النجاح

| المرحلة | الدليل | حالة هذا التدقيق |
|---|---|---|
| مدرج | هوية وإصدار وقناة في فهرس مثبت | الجرد الكامل محفوظ |
| له طريق تنزيل | URL أو مسار مصدر مثبت | طريق معلوم؛ لا يثبت تنزيل جميع العناصر |
| بايتات متحققة | حجم كامل وSHA مطابق وهوية داخل الحزمة | متحقق للحزم الـ 21 المحددة |
| مؤهل ساكنًا | موارد ID8 وربطها أو مولّد/عقد منصة فعلي، واعتماديات محددة | مؤهل بشروط وحدود ظاهرة |
| مُجهّز | تحضير فعلي بـSDK الهدف وفحص ناتجه | NOT_OBSERVED |
| قابل للتثبيت على الهدف | HMI وABI ونسخ الأدوات وشروط الهدف متحققة | NOT_ESTABLISHED |
| مثبت | الحالة النهائية والهوية والإصدار في سجل الهدف دون نتيجة معلقة | NOT_OBSERVED |
| يعمل | فتح التطبيق وملاحظة الوظائف على الهدف المعين | NOT_OBSERVED |

## ما الذي يدعم أهلية المصادر؟

- عائلة cauliflowermossgrape الأصلية: بيانات 15 تطبيقًا مرتبطة ببصماتها، والمولّد ينشئ موارد العائلتين ويربطها، بينما يختار وقت التشغيل ID8 بواسطة المورد الفعلي. الدليل التاريخي المنطبق لا يتحول إلى نتيجة اختبار جديد.
- ثماني عائلات AQ المنقولة، بإجمالي 14 تطبيقًا: تُقرأ الملفات الحالية في apps/_ports مع بيانات PORT/AQ_PORT ومولّد ID8 ودورة التشغيل والمصيّر. الأصل يبقى منفصلًا في apps/_sources، وتبقى حدود الوظائف والتراخيص محفوظة.
- ثماني وصفات Python إضافية: andrei_mdrive وkm_motordaten وc365_drive وpps_gauges وpps_warmup وثلاثة تطبيقات giuseppe ID8. روجع مسار توليد وربط ID8 الفعلي، لا اسم المستودع.
- ستة تطبيقات unit: توجد موارد ID8 وربطها في شجرة الحزمة المعلنة، ومنها robertn_store المستعاد بإصدار 0.9.41. ملفات SDK مداخل تأتي من الهدف، وليست SDK موزعة.
- حزمتا bm3_live_id8 وturnkey_e_blend_id8: البايتات الأصلية المتعقبة وهويتها وموارد ID8 متحققة. وجود وصفة Node لا يعني تشغيلها هنا.
- 13 تطبيق إصدار، ومنها bcs_store 3.4.5 المستعاد: ثبتت هوية الحزمة الحالية وربط واجهتها بـID8. بعض TGZ حزم مصدر تحتاج تحضيرًا على الهدف؛ الامتداد لا يثبت أنها ناتج جاهز للتشغيل.

## التطبيقات المؤهلة ساكنًا

| التطبيق والإصدار | القناة | الدليل الساكن | تشغيل الهدف |
|---|---|---|---|
| `bcs_store@3.4.5` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_ambient@1.4.3` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_cardash@1.4.1` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_draggy@1.2.0` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_dtcscan@1.2.0` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_edrive@1.1.0` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_liveadjust@1.2.0` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_overlays@1.4.0` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_seats@1.6.3` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_service@1.0.0` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_tailscale@1.2.0` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `iteriodev_turnview@1.6.0` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `oap-driverecorder-next@2.5.1` | release | verified_current_archive_and_id8_rhmi | NOT_OBSERVED |
| `ab_storage@1.2.4` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `adam_shiftlights@0.4.6` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `adam_vitals@0.2.0` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `ambient_config@2.7.13` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `andrei_mdrive@0.4.0` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `aref_carcare@0.2.4` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `aref_carlyrics@0.3.10` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `aref_explorer@0.2.3` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `bimmer_blocks@1.1.1` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `bm3_live_id8@0.1.1` | source | tracked_publisher_archive_id8_resources | NOT_OBSERVED |
| `boostline_id8@1.0.0` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `brake_test@1.5.21` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `c365_drive@1.9.3` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `car_vitals@2.27.9` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `dimon_track_mode@1.0.1` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `doom@1.7.22` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `dpf_id8@1.0.0` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `draggy@2.6.0` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `dtc_scanner@2.9.8` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `dyno@1.6.3` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `e85@1.2.2` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `edrive@2.11.0` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `esagono_settings@0.1.0` | source | staged_unit_source_id8_selector_and_resources | NOT_OBSERVED |
| `gforce@1.6.22` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `ida_lightlog@1.3.1` | source | staged_unit_source_id8_selector_and_resources | NOT_OBSERVED |
| `ida_seatlights@1.3.2` | source | staged_unit_source_id8_selector_and_resources | NOT_OBSERVED |
| `ida_vitals@1.3.1` | source | staged_unit_source_id8_selector_and_resources | NOT_OBSERVED |
| `km_motordaten@0.4.1` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `live_adjustments@0.9.10` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `live_data@1.0.18` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `m_copilot@1.0.31` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `mazzahaker_xdrive_remover@0.1.26` | source | staged_unit_source_id8_selector_and_resources | NOT_OBSERVED |
| `parked_games@0.2.3` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `pps_gauges@1.0.3` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `pps_warmup@1.2.1` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `redline@2.0.45` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `robertn_store@0.9.41` | source | staged_unit_source_id8_selector_and_resources | NOT_OBSERVED |
| `service@1.6.3` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `spotify@1.0.30` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `sys_monitor@1.0.4` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `true_time_id8@1.0.0` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `turnkey_e_blend_id8@0.5.0` | source | tracked_publisher_archive_id8_resources | NOT_OBSERVED |
| `vehicle_pass@1.1.1` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `warmup@1.9.0` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |
| `zf8hp@1.5.8` | source | reviewed_id8_generator_and_runtime_contract | NOT_OBSERVED |

## إغلاق الاعتماديات

| الأداة والإصدار المختار | القناة | اعتمادياتها الدنيا |
|---|---|---|
| `iteriodev-comfort@0.6.3` | external | `mgu-deploy >= 0.7.11` |
| `iteriodev-drplay@1.2.6` | external | none declared |
| `iteriodev-overlays@0.5.0` | external | `mgu-deploy >= 0.7.11`, `mgu-render >= 0.6.10` |
| `iteriodev-screencast@1.0.9` | external | `iteriodev-tailscale >= 1.104.4` |
| `iteriodev-tailscale@1.104.6` | external | `mgu-uplink >= 0.4.0` |
| `iteriodev-turnview@0.9.1` | external | `cluster-render >= 0.5.10`, `mgu-deploy >= 0.7.11` |
| `app-privacy@1.7.2` | release | `mgu-deploy >= 0.6.3` |
| `mgu-deploy@0.8.27` | release | none declared |
| `mgu-python@1.0.3` | release | none declared |
| `mgu-render@0.6.25` | release | `mgu-deploy >= 0.6.9` |
| `mgu-updater@0.8.51` | release | `mgu-deploy >= 0.8.4`, `mgu-python >= 1.0.2` |
| `mgu-uplink@0.7.13` | release | `mgu-updater >= 0.7.2` |
| `cluster-render@0.6.9` | source | `mgu-deploy >= 0.4.0` |
| `esagono-cluster@0.2.1` | source | `cluster-render >= 0.6.9`, `iteriodev-overlays >= 0.5.0`, `mgu-deploy >= 0.7.0` |
| `ida-vitals-cluster@1.3.3` | source | `cluster-render >= 0.6.9`, `mgu-deploy >= 0.7.0` |
| `idrive7-renderd@2.1.19` | source | `mgu-deploy >= 0.6.1` |
| `mgu-inputgate@1.2.2` | source | `mgu-deploy >= 0.3.2` |

يربط JSON كل حد أدنى بنسخة وقناة محددتين، ويفحص السلسلة انتقالياً. لا يُفترض وجود Store أو مصدر على HU مسبقًا، ولا يُستبدل اسم أداة بأخرى لمجرد التشابه.

تضيف وصفات Python الـ 37 اعتماد **mgu-python >=1.0.2** حتى عند غيابه من app.requires. وتحتفظ وصفة build.sdk باعتماد **mgu-deploy >=0.3.2** حسب sources.js الأصلي. متطلبات البناء منفصلة عن التشغيل وكلاهما مربوط بالنسخ. SDK وNode ومداخل البيئة موثقة دون توزيع SDK أو تشغيل سكربتات.

يفتقد فرع ID8 التاريخي mgu-python لهذه الوصفات، كما يفتقد سلسلة mgu-uplink ثم mgu-updater المطلوبة انتقالياً بواسطة iteriodev-tailscale. توجد النسخ الأصلية في الفهرس الشامل؛ يجب أن يحتفظ الاشتقاق بالسلسلة كاملة.

## نتائج تصحيحية وحدود مؤثرة

1. شارة Helper Tools78 وتقرير Gemini لا يمثلان عدّ الفهارس الحالية. العدد المرجعي للأدوات يشمل 74 محلية وستًا خارجية.
2. السجل القديم يحوي mgu-render 0.6.24 وإصدارات أقدم لثلاثة تطبيقات Iterio؛ لم تُنسب براهينها إلى الإصدارات الجديدة. فُحصت 0.6.25 والإصدارات الحالية بطولها وبصمتها ومواردها الفعلية.
3. بعض بصمات data/id8-ports.json لا تطابق المصدر الحالي بعد تغييرات التوطين ومداخل البناء. تُسجل الفروق ولا يُستنتج منها نجاح بناء جديد. البوابات الفاشلة التي كشفها تشغيل المراجعة الرئيسية تبقى مسألة مستقلة يجب حلها.
4. يوجد **83 بيان مصدر أولي دون HMI صريح**. غياب الحقل لا يتحول إلى ID8 أو ID7. بعض unit يعلنه في package.json وRHMI، والمنقولات لها أدلة منصة أخرى؛ يسجل JSON الطبقات منفصلة.
5. component.json في mgu-deploy/updater/uplink يغيب عنه HMI. يُحفظ الغياب، ويُربط التصريح الصريح في الفهرس بعقد المنصة الأصلي ذي مسار ID8 وبالهوية الحالية للحزمة. المصدر المرجعي التاريخي قد يكون أقدم من إصدار الحزمة، ولا يُدّعى تطابقهما البرمجي.
6. **ida_lightlog يملك بديل قائمة HMI عند غياب المصيّر**؛ GPU تحسين اختياري. لا يصح اختلاق اعتماد إلزامي أو حد إصدار بناء على مجرد وجود gpu.js. الفهرس الحالي يذكر mgu-render بالفعل لـida_seatlights وida_vitals وmazzahaker_xdrive_remover.
7. pps_gauges وpps_warmup وتطبيقات giuseppe الثلاثة وEsagono وعائلة IDA تصرح بحدود أو غياب التجربة على السيارة. تظل هذه العبارات ظاهرة رغم أهلية العقد الساكن. تجربة إصدار أقدم من mazzahaker لا تثبت تشغيل 0.1.26.
8. HUD والعدادات محفوظة في الجرد. دعم HMI لا يثبت تساوي أهداف الرسم والقدرات بين العائلتين؛ لا يُرقّى تطبيق ID7 لأن مصيّره يدعم ID8.
9. مراجع Iterio ليست حمولات AQ ولا دليل وجود أدوات مثبتة. يُضاف المصدر الأصلي صراحة وتتحقق بايتاته عند الجلب.

## شروط قبول الاشتقاق والنشر

1. مطابقة الهوية والإصدار والقناة والالتزام وبصمة كل إحالة؛ لا يقبل دليل نسخة أخرى.
2. طلب تصريح ID8 ودليل مورد/منصة فعلي. تُرفض unknown وconflict وdeclared_only وdependency_blocked.
3. حفظ الاعتماديات وحدودها ومداخل البناء والملفات المشتركة والتراخيص والصور. تبقى SDK مداخل هدف معلنة، ولا تتجاوز أهلية المنصة أخطاء البناء.
4. الاشتقاق إلى مسار جديد من الالتزام المثبت، مع حفظ الفروع والعمل غير المحفوظ، دون checkout قسري أو حذف worktree.
5. عرض معاينة النشر وهوية الهدف والالتزام الأساسي والنسخ والملفات والبصمات، وإعادة التحقق من ثبات الهدف قبل أي تحديث. هذا التدقيق لم ينشر.
6. عدم رفع حالة التحضير أو التثبيت أو التشغيل بسبب نجاح الفهرسة والتنزيل والفحص الساكن.

## السجل الكامل

data/id8-eligibility-20261120.json يحفظ جميع النسخ وروابط الأدلة والحدود الدنيا ومداخل البناء والبراهين الجديدة للحزم وحالات التشغيل. مصدر الحقائق هو mgu-repo.json وrelease/catalog.json وdata/external-store-components.json وملفات التطبيقات والأدوات عند الالتزام المرجعي. استُخدم تقرير Gemini لإثارة نقاط مراجعة، ولم يُعامل كدليل تشغيل على HU.

## توزيع الألعاب وحفظ تاريخه الكامل

أُضيف إعداد games بسياسة preservation وtarget_hmi=null من الالتزام التاريخي **1965ef4a7736d664681542436cc7c0e8c45d316c**. هذا توزيع حفظ، ولا يمنح عناصره تأهيل ID8 جديدًا. حالة incompatible في سجل الأهلية تعني الاستبعاد من بوابة ID8 المحددة، ولا تعني حذف العنصر من games.

يحوي التاريخ **44 نسخة قناة، تخص 39 معرّفًا فريدًا**. يختار الإعداد الحالي **40 مزوّدًا فريدًا: 23 تطبيقًا و 17 أداة** مع الإغلاق الكامل للاعتماديات. تُحفظ جميع هويات القنوات التاريخية، بما فيها المزوّدات المكررة للمعرّف نفسه، في historical_preservation_observations.games؛ اختيار مزوّد حالي واحد لا يُعرض كتطابق بايتات مزوّد قديم.

بقيت Moonride وتطبيقها وأداة Node 22، وMoonlight وتطبيقها وأدواتها، وكذلك الأدوات التاريخية المستقلة. لا تُستخدم قائمة تصنيف ألعاب مختصرة لإسقاط هذه العناصر.

يوجد **11 ترحيلًا صريحًا** فقط حيث يختلف الملف التعريفي أو القناة أو الإصدار أو بصمة المدخلات المعلنة. لكل ترحيل to وreason، ولكل نسخة قديمة ملفها التعريفي الكامل وبصمته والتزامها، وهوية المزوّد المختار وبصمة مدخلاته. يسجل الفرق أعداد المسارات المضافة والمعدلة والمستبعدة من نطاق الاختيار وبصمة الفرق الكامل القابل لإعادة الإنتاج من الالتزامين؛ لا تُحذف ملفات أثناء ذلك.

تشمل الأسباب انتقال أدوات Store من النسخ المصدرية المكررة إلى حزم الناشر الحالية المتحققة، وانتقال مزوّدَي Vizualyse إلى مساريهما المصدرية المحددين، وتثبيت مداخل kit/tools لـGame Station وإضافة توطين Road Hopper المفقود من build.shared. نطاق Game Station التاريخي كان المستودع كاملًا عند غياب shared؛ البصمة التاريخية الكاملة محفوظة، ويُعرض تضييق النطاق كترحيل واضح. يبقى بناء الناتج وتشغيله غير ملحوظين، وتبقى بوابات النشر الفعلية إلزامية.

### المزوّدات الحالية المختارة لتوزيع الألعاب

| Current identity | Channel | Kind | Runtime |
|---|---|---|---|
| `app-privacy@1.7.2` | release | tool | NOT_OBSERVED |
| `aurelm_apex_chase@1.0.0` | release | app | NOT_OBSERVED |
| `aurelm_blackjack@1.0.1` | release | app | NOT_OBSERVED |
| `aurelm_lap_record@1.0.0` | release | app | NOT_OBSERVED |
| `aurelm_lucky_sevens@1.1.0` | release | app | NOT_OBSERVED |
| `aurelm_pinball@1.0.1` | release | app | NOT_OBSERVED |
| `aurelm_pit_wall@1.0.0` | release | app | NOT_OBSERVED |
| `aurelm_ridge_duel@1.0.1` | release | app | NOT_OBSERVED |
| `aurelm_snake@1.0.0` | release | app | NOT_OBSERVED |
| `aurelm_solitaire@1.0.0` | release | app | NOT_OBSERVED |
| `aurelm_street_siege@1.1.0` | release | app | NOT_OBSERVED |
| `aurelm_track_defender@1.0.0` | release | app | NOT_OBSERVED |
| `doodle-gpu@1.0.0` | release | tool | NOT_OBSERVED |
| `jap-moonride@0.3.4` | release | tool | NOT_OBSERVED |
| `jap-node22@22.23.4` | release | tool | NOT_OBSERVED |
| `jap_moonride@0.3.4` | release | app | NOT_OBSERVED |
| `kxrxh_doodle_jump@0.9.0` | release | app | NOT_OBSERVED |
| `mgu-deploy@0.8.27` | release | tool | NOT_OBSERVED |
| `mgu-python@1.0.3` | release | tool | NOT_OBSERVED |
| `mgu-render-id7-touch@1.4.0` | release | tool | NOT_OBSERVED |
| `mgu-render@0.6.25` | release | tool | NOT_OBSERVED |
| `mgu-updater@0.8.51` | release | tool | NOT_OBSERVED |
| `mgu-uplink@0.7.13` | release | tool | NOT_OBSERVED |
| `vizualyse-steam@0.4.0` | release | tool | NOT_OBSERVED |
| `vizualyse_steam@0.2.1` | release | app | NOT_OBSERVED |
| `bimmer_blocks@1.1.1` | source | app | NOT_OBSERVED |
| `cluster-render@0.6.9` | source | tool | NOT_OBSERVED |
| `dk_backgammon@0.1.1` | source | app | NOT_OBSERVED |
| `dk_tetris@0.1.1` | source | app | NOT_OBSERVED |
| `doom@1.7.22` | source | app | NOT_OBSERVED |
| `iabadia_m_arcade@0.1.3` | source | app | NOT_OBSERVED |
| `idrive7-renderd@2.1.19` | source | tool | NOT_OBSERVED |
| `mgu-game-net@0.1.0` | source | tool | NOT_OBSERVED |
| `mgu-inputgate@1.2.2` | source | tool | NOT_OBSERVED |
| `mgu_gamestation@0.3.0` | source | app | NOT_OBSERVED |
| `mx_road_hopper@0.1.1` | source | app | NOT_OBSERVED |
| `parked_games@0.2.3` | source | app | NOT_OBSERVED |
| `vizualyse-bus@0.1.0` | source | tool | NOT_OBSERVED |
| `vizualyse-moonlight@0.3.1` | source | tool | NOT_OBSERVED |
| `vizualyse_moonlight@0.3.1` | source | app | NOT_OBSERVED |

### تصحيح تصنيف الألعاب وحدّ حجم Steam

تسجل البيانات الحالية **20 لعبة**، ويصنّف عرض README **20 تطبيقًا** ضمن Games. أُصلح اختلاف الالتزام B، الذي كان يسجل 18 لعبة في البيانات و 19 في العرض: أصبحت category لكل من GameStation وRoad Hopper هي game، وتُعطى بيانات اللعبة الصريحة الأولوية على الكلمات العامة، لذلك بقي aurelm_track_defender ضمن Games. يحفظ الاختيار كل العناصر؛ هذا تصحيح تصنيف، ولا يغيّر أهلية HMI.

أُضيفت واجهة **vizualyse_steam 0.2.1** لأنها مخصصة صراحةً لتشغيل الألعاب، مع ربطها بأداة vizualyse-steam المطلوبة. إيصال الفحص `data/vizualyse-frontend-inspection-20261120.json` مربوط بالرابط والحجم وSHA الحاليين، ويثبت حزمة مصدر unit وملفات ID7؛ التشغيل الفعلي يبقى NOT_OBSERVED. بقيت واجهتا Moonride وMoonlight وأدواتهما من التاريخ الكامل، ولم تُضف تطبيقات التحكم بالمركبة أو المتصفح إلى الألعاب بسبب كلمات عامة في الوصف.

حجم أرشيف أداة **vizualyse-steam** المعلن هو **531,211,774 بايت**. يتجاوز هذا حدود الاكتساب/الحزم الحالية في Manager، لذلك يظل قيدًا تشغيليًا موثقًا، مع إبقاء المزوّد واعتمادياته في الاختيار. لم تُنزّل هذه الحزمة الكبيرة خلال المراجعة؛ الحجم والبصمة والرابط من كتالوج الناشر. هذا القيد مستقل عن أهلية ID8 وعن حقيقة وجود الأداة.

### حفظ مدخلات المصدر التاريخية وميزانية التوزيع

حُفظت 26 نسخة فريدة من مدخلات Doom التاريخية، مجموعها 420,924 بايت، تحت `archive/games-1965ef4`، مع أربعة ملفات ترخيص وإشعار أصلية. يربط `data/games-source-preservation-20261120.json` كذلك 191 ملفًا تاريخيًا من Doom و 15 ملفًا من Road Hopper بنسخ حالية ذات بايتات ووضع Git مطابقين. تحقق هذا التوليد من بايتات الأرشيف وأوضاعه والبصمات عند الالتزام المرجعي. أضيف الأرشيف والإيصال والتقرير العربي إلى extra_paths الخاصة بالتوثيق والحفظ؛ بقيت وصفة البناء النشطة ومتطلبات التشغيل كما هي.

ميزانية تصدير ملفات التوزيع المعتمدة صراحةً هي **256 MiB لـID8** و**200 MiB للألعاب**، مع احتساب بيانات الخطة وإيصال التصدير. يحتفظ الاختيار بالوسائط والوثائق الأصلية. هذه ميزانية حزمة ملفات التوزيع؛ حدود اكتساب واستيراد حزم Manager مستقلة وتبقى ملاحظة حجم Steam سارية.
