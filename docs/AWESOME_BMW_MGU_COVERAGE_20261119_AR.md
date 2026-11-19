# تغطية قائمة awesome-bmw-mgu ومصادرها الأصلية

تاريخ مراجعة المصادر: **2026-11-19**.

هذا التقرير يقارن القائمة الكاملة مع نقطة أساس AQ_MGU قبل إصلاحات هذه الجولة. توجد **53 مستودع GitHub فريدًا** ضمن **56 رابطًا**؛ التكرارات الثلاثة تخص توثيق SDK والنشر وبروتوكول الرسم. أضيف رابط النقاش الخارجي إلى قسم المراجع. كانت نقطة الأساس تحتوي **61 مكونًا** و**11 مصدرًا من مشاريع هذه القائمة**. هذه أعداد جرد وليست نتيجة تثبيت.

- القائمة المثبتة: [`FidelisClayton/awesome-bmw-mgu@9e6829775dee`](https://raw.githubusercontent.com/FidelisClayton/awesome-bmw-mgu/9e6829775dee8abd16f006f55663eb6f7865f118/README.md).
- نقطة أساس AQ_MGU: `f424cf4e0e1844b23e5f5bcf9ce40b22b8ed6cfe`.
- السجل التفصيلي: [`data/awesome-bmw-mgu-coverage.json`](../data/awesome-bmw-mgu-coverage.json). يتضمن لكل مشروع commit وبيانات الترخيص وروابط البيانات الأصلية ومعرفات التطبيقات والأدوات والمتطلبات وHMI المعلن.
- نتائج التثبيت على وحدة فعلية لكل عناصر هذه المقارنة: **NOT OBSERVED**.

## التنفيذ بعد المراجعة

تعكس شجرة العمل المصححة **140 سجلًا** في بيانات العرض: **55 مكونًا من المصدر** و**79 حزمة عبر كتالوج الإصدار** و**6 أدوات أصلية خارجية**. وبذلك يضم فهرسا AQ القابلان للقراءة بواسطة Store **134 مكونًا**؛ الأدوات الست المتبقية مراجع بيانات لمصدر IterioDev الأصلي. تحفظ المقارنة التاريخية أدناه أرقام نقطة الأساس، بينما يحفظ حقل `integration_after_audit` في JSON ما أُدرج بعد المراجعة لكل ناشر.

أضيفت حزم تطبيقات IterioDev الاثنتا عشرة بروابط الناشر المثبتة وحجمها وSHA256، مع `build: unit` ومتطلب renderer وتصريح HMI لكل تطبيق. وثّقت أدواتها الست في [`data/external-store-components.json`](../data/external-store-components.json) دون إرفاق حزمة بديلة أو مسار AQ تنفيذي. يتطلب حلها إضافة مصدر `aq-mgu-iteriodev` من مستودع `IterioDev/car-apps` بقناة **`branch:main`**. تعريف هذا المصدر محفوظ مع مصدري AQ في [`data/store-sources.json`](../data/store-sources.json)، ولا يستورده Store تلقائيًا عند إضافة AQ.

يحفظ [`data/community-store-sources.json`](../data/community-store-sources.json) **26 مسار مصدر أصلي** مع أدلة القنوات والتحذيرات من تعارض المعرفات. هذا دليل مراجع؛ لا يطلب إضافة جميع الناشرين دفعة واحدة ولا ينشئ اشتراكات بالنيابة عن المستخدم. لا يعاد تسمية معرف حزمة أصلية لحل تعارض ناشرين.

نجح المدقق المحلي في إغلاق التبعيات عبر المصدر وكتالوج الإصدار والأدوات الخارجية بشرط وجود إعداد مصدرها، ورفض الاعتماد على أداة ID7 لتطبيق يعرض ID8. شملت اختبارات الفشل حذف المصدر الأصلي، والاعتماد على أداة مجهولة، والإصدار المبتور، ومرجع ناقص من `aref_eta` إلى تطبيق آخر. اختبرت آلية Store الأصلية قراءة الفهارس وتخطيط التبعيات، باستخدام ملاحظات بيانات الأدوات الست في الذاكرة فقط. لم تجلب هذه الاختبارات أدوات IterioDev ولم تثبتها على وحدة.

## ما تبين من المقارنة

القائمة المرجعية أوسع من المستودع السابق: توجد فيها تطبيقات بيانات وألعاب وخدمات فيديو ومشاريع ID8 لم تكن ضمن مصادره. كذلك تتضمن أدوات حاسوب ومشاريع عتاد ومواد تطوير وتطبيق NBT؛ تحفظ هذه كمراجع ولا تتحول إلى حزم MGU لمجرد ورودها في القائمة.

بيانات القائمة تصف مراجعة سابقة بتاريخ 2026-11-06. لذلك استُخدمت ملفات البيان الحالية المثبتة لكل ناشر لتحديد النسخة وHMI، ولم تُنسخ ملصقات القائمة بوصفها ضمان توافق. الملفات التي لا تعلن HMI تسجل ذلك صراحة.

## اختلاف ID7 وID8 المثبت في المصادر

مصدر [cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps/tree/5555ef3bd2195aae15a8cec6803beeb40ca16456) الحالي يعلن ID7 وID8 لتطبيقاته الخمسة عشر وأداتي `idrive7-renderd` و`mgu-inputgate`. نقطة أساس AQ_MGU تستخدم snapshot أقدم؛ لا يجوز نقل إعلان التوافق الجديد إلى ملفات النسخة القديمة دون ترقية مصدرها والتحقق من مسار البناء والتبعيات.

مصدر [IterioDev/car-apps](https://github.com/IterioDev/car-apps/tree/22a141241d6d329ea671426749a8a029ac22258e) يعلن التوافق لكل تطبيق وأداة. توجد 12 حزمة تطبيق `.tgz` أصلية داخل مجلدات التطبيقات، وستة مجلدات أدوات ببيانات `component.json`. ملف `tools/prebuilt.js` يوضح أن حزمة التطبيق جاهزة وأن وصف البناء يشير إليها.

| التطبيق | الإصدار المرصود | HMI المعلن |
|---|---|---|
| `iteriodev_ambient` | `1.4.2` | ID7, ID8 |
| `iteriodev_cardash` | `1.4.1` | ID8 |
| `iteriodev_draggy` | `1.2.0` | ID8 |
| `iteriodev_dtcscan` | `1.2.0` | ID8 |
| `iteriodev_edrive` | `1.1.0` | ID8 |
| `iteriodev_liveadjust` | `1.2.0` | ID8 |
| `iteriodev_overlays` | `1.4.0` | ID8 |
| `iteriodev_seats` | `1.6.3` | ID7, ID8 |
| `iteriodev_service` | `1.0.0` | ID8 |
| `iteriodev_tailscale` | `1.1.1` | ID7, ID8 |
| `iteriodev_turnview` | `1.5.1` | ID7, ID8 |
| `oap-driverecorder-next` | `2.5.1` | ID7, ID8 |

هذا التصنيف يصف ملفات المصدر. نجاح النسخة على سيارة معينة لا يستنتج من نجاح المحاكي أو من وجود الحزمة. الفرق بين مسارات ID7 وID8 يعالج في طبقة النشر الأصلية وفي بيانات الحزمة؛ ليس بتغيير ملصق HMI فقط.

### تحقق حزم IterioDev الأصلية

نُزلت الحزم الاثنتا عشرة من روابطها المثبتة عند commit المذكور أعلاه إلى الذاكرة، وقورن حجم كل حزمة وGit blob SHA-1 مع شجرة المستودع، وحُسب SHA-256 من البايتات نفسها. نجحت المقارنة في **12/12** حزمة. فُحص غلاف tar وملفات البيان دون استخراج الملفات أو تشغيل البرنامج أو حفظ نسخة لإعادة النشر.

تحتوي كل حزمة على `mgu-app.json` و`<id>@<version>/package.json` و`src`. تطابقت تصريحات HMI داخل `package.json` مع بيان التطبيق الأصلي. لم تظهر مسارات باسم `oap-sdk` أو `OnlineApp.js` ضمن أسماء الأعضاء؛ بقي `oap-sdk: 24.10.2` اعتمادًا معلنًا في البيان. يسجل JSON الحجم وSHA256 ونتيجة مطابقة Git blob وبيانات الحزمة لكل تطبيق. هذا تحقق نقل وغلاف حزمة، ولا يثبت التسجيل أو التشغيل داخل الوحدة.

## المصادر والأدوات المطلوبة

يحفظ السجل `requires` و`needs` عند إعلانهما، مع رابط البيان الذي وردا فيه. عندما يرث التطبيق متطلبات أو HMI من `mgu-repo.json` يسجل رابط القاعدة الأصلية أيضًا. عدم إعلان `requires` لا يسجل كإثبات انعدام المتطلبات.

أمثلة الفروق المهمة في المصادر المرصودة:

- تطبيقات `jap_ridetube` و`jap_ridewatch` و`jap_moonride` لها خدمات مستقلة، ومعها متطلبات Node.js أو renderer أو uplink بحسب البيان. كانت هذه المشاريع غائبة عن مصادر نقطة الأساس.
- `kxrxh_doodle_jump` يعلن `doodle-gpu` إضافة إلى إصدارات دنيا من renderer وPython؛ إضافة واجهته فقط لا تكمل تبعياته.
- تطبيقات Ambient وSeats من IterioDev تحتاج `iteriodev-comfort`، وOverlays تحتاج `iteriodev-overlays`، وDrive Recorder يحتاج `iteriodev-drplay`، وTailscale يحتاج أداته المقابلة. تبقى هوية الناشر الأصلي وروابطه محفوظة.
- ألعاب `aurelmarius/bmw-games` الإحدى عشرة لها كتالوج أصلي يحوي size وSHA256 وروابط الحزم. ثماني ألعاب تتقاطع مع النواقص التي ظهرت في مراجعة AQcheatool، وتوجد ألعاب إضافية في الأصل الأحدث.
- `iAbadia/idrive-games` يحتفظ ببيانات ألعاب منفردة أقدم، بينما `mgu-repo.json` الحالي يعرض `iabadia_m_arcade` وحده. يفصل الجرد بين ملف موجود في المصدر ومكون تعرضه قناة Store فعلًا.

### إضافة المصدر الأصلي للأدوات المكملة

Store الأصلي لا يضيف مصادر أخرى تلقائيًا من ملف إعداد داخل مستودع AQ_MGU. لذلك توثيق مصدر في `data/store-sources.json` أو في سجل التغطية لا يعني أنه أصبح مفعّلًا على الوحدة. تحتاج التبعيات الخارجية إلى مصدرها الأصلي ضمن قائمة Sources في Store.

تأتي أدوات IterioDev الست من `IterioDev/car-apps`. يسجل إعداد Store الأصلي قناة `tags` لهذا المصدر، واعتمدت هذه المراجعة مسار **`branch:main`** الموافق لبيانات الفرع التي فُحصت؛ يضاف من [`https://github.com/IterioDev/car-apps/tree/main`](https://github.com/IterioDev/car-apps/tree/main). تشمل الأدوات Comfort وDrive Recorder player وOverlays وScreen share وTailscale وTurn View؛ تحفظ مساراتها ومتطلباتها الأصلية في سجل JSON. لا تضاف القناتان كمصدرين للمستودع نفسه. التفعيل الفعلي للمصدر وحل هذه التبعيات على الوحدة لم يُرصدا في هذه الجولة.

المشروعان `evangoyuk/mgu-store-apps` و`sembsa/idrive7-ambient` يوثقان قناة **Releases** الأصلية. الأول يرفق `mgu-store.json` وحزم OAP في إصداراته. يجب إبقاء هذه الآلية مستقلة عن كتالوج schema 2؛ عدم وجود `catalog.json` في الجذر لا يعني عدم دعم Store.

## الترخيص والناشر وهوية الحزمة

ترخيص القائمة CC0 لا يغير ترخيص المشاريع التي تشير إليها. لا يفترض هذا التقرير أن ترخيص kit أو ملف الجذر يغطي SDK أو كل مواد الطرف الثالث أو كل لعبة. كل سجل يحفظ رابط الترخيص ونطاقه المرصود.

ترخيص [IterioDev المثبت](https://github.com/IterioDev/car-apps/blob/22a141241d6d329ea671426749a8a029ac22258e/LICENSE.md) يسمح بالتثبيت دون تغيير من المصدر الأصلي، ويقيد إعادة التوزيع والتعديل والعلامة التجارية. لذلك يفصل السجل مرجع المصدر الأصلي عن نسخ ملفات البرنامج إلى AQ_MGU. وبالنسبة للمصادر التي لم يعثر لها على منحة في LICENSE أو LICENSE.md، يبقى وجود الكتالوج الأصلي موثقًا دون اختراع ترخيص.

مصدر `PenguinDukeYDAuto/idrive7-EVAHUD` مثال آخر: يحتاج إلى خطوط MatissePro يوفّرها المستخدم، وينص README على عدم نشر ملف `.mgu` المتضمن أشكال هذه الخطوط. وجود ترخيص للكود لا يزيل هذا الشرط، ولذلك بقي مرجع المصدر موثقًا دون نشر حزمة مشتقة منه.

بعض الكتالوجات والفروع تعيد استخدام معرفات مثل `cluster-render` و`waze-on-cluster` و`robertn_store`. وجود إصدار أعلى لدى fork لا يكفي لاستبدال ناشرها الأساسي. الملفات التنفيذية والبيانات الداخلية تحتاج إلى الهوية نفسها؛ لا يحل تغيير اسم المعرف في الفهرس التعارض.

## التغطية الكاملة للمشاريع

عمود HMI يجمع التصريحات المرصودة داخل المشروع لتسهيل القراءة. أهلية التطبيق المفرد تؤخذ من سجله التفصيلي، وقد يدعم بعض تطبيقات المشروع ID7 وبعضها ID8 فقط. أعداد المعرفات في الجدول تشمل الملفات المكتشفة والكتالوجات ولا تعني أن كل ملف معروض في قناة Store.

| المشروع الأصلي | حالة المقارنة | HMI مرصود | معرفات مكتشفة / ناقصة عن نقطة الأساس |
|---|---|---|---|
| [cauliflowermossgrape/idrive7-8-ssh-root](https://github.com/cauliflowermossgrape/idrive7-8-ssh-root) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [robertnisipeanu/mgu-store](https://github.com/robertnisipeanu/mgu-store) | مصدر ممثل سابقًا | ID7، ID8 | 7 / 0 |
| [robertnisipeanu/idrive-apps](https://github.com/robertnisipeanu/idrive-apps) | مصدر ممثل سابقًا | ID7، ID8 | 3 / 0 |
| [bimmer-lab/apps](https://github.com/bimmer-lab/apps) | مصدر ممثل سابقًا | ID7 | 2 / 0 |
| [isaakbruno2/carplay-map-cluster](https://github.com/isaakbruno2/carplay-map-cluster) | مصدر ممثل سابقًا | ID7 | 2 / 0 |
| [kxrxh/bmw-clusters-mgu](https://github.com/kxrxh/bmw-clusters-mgu) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [eroobeeroo/idrive7-apps](https://github.com/eroobeeroo/idrive7-apps) | مصدر بناء متاح | ID7 | 4 / 3 |
| [PenguinDukeYDAuto/idrive7-EVAHUD](https://github.com/PenguinDukeYDAuto/idrive7-EVAHUD) | يحتاج مراجعة تغليف Store | غير معلن في البيانات المفحوصة | 1 / 1 |
| [cruzen991/Cluster](https://github.com/cruzen991/Cluster) | مصدر بناء متاح | ID7 | 2 / 2 |
| [sergshamiryan/mgu-gear-cluster](https://github.com/sergshamiryan/mgu-gear-cluster) | مصدر بناء متاح | ID7 | 1 / 1 |
| [JustAnotherPU/waze-hud](https://github.com/JustAnotherPU/waze-hud) | مصدر ممثل سابقًا | ID7، ID8 | 3 / 0 |
| [Vizualyse/idrive-apps](https://github.com/Vizualyse/idrive-apps) | مصدر ممثل سابقًا | ID7 | 12 / 0 |
| [Impossible43/vlad-mgu-apps](https://github.com/Impossible43/vlad-mgu-apps) | مصدر ممثل سابقًا | ID7 | 2 / 0 |
| [noth4m4d/mgu-hamadstools](https://github.com/noth4m4d/mgu-hamadstools) | مصدر ممثل سابقًا | ID7 | 4 / 0 |
| [cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps) | مصدر ممثل سابقًا | ID7، ID8 | 17 / 0 |
| [aurelmarius/bmw-apps](https://github.com/aurelmarius/bmw-apps) | كتالوج أصلي متاح | ID7 | 7 / 7 |
| [arefahmad/idrive7-apps](https://github.com/arefahmad/idrive7-apps) | مصدر بناء متاح | ID7 | 9 / 9 |
| [pinguinooo/idrive7-apps](https://github.com/pinguinooo/idrive7-apps) | مصدر بناء متاح | ID7 | 3 / 3 |
| [JustAnotherPU/mgu-apps](https://github.com/JustAnotherPU/mgu-apps) | كتالوج أصلي متاح | ID7 | 3 / 3 |
| [benspa900/mon-vitals-idrive7](https://github.com/benspa900/mon-vitals-idrive7) | مصدر بناء متاح | ID7 | 4 / 3 |
| [dzooky/bmrmodz](https://github.com/dzooky/bmrmodz) | مصدر بناء متاح | ID7 | 5 / 4 |
| [nickgcode/idrive7-apps](https://github.com/nickgcode/idrive7-apps) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [hexlay/idrive7-custom-apps](https://github.com/hexlay/idrive7-custom-apps) | مصدر ممثل سابقًا | ID7 | 3 / 0 |
| [JustAnotherPU/ridetube](https://github.com/JustAnotherPU/ridetube) | كتالوج أصلي متاح | ID7 | 2 / 2 |
| [JustAnotherPU/ridewatch](https://github.com/JustAnotherPU/ridewatch) | كتالوج أصلي متاح | ID7 | 2 / 2 |
| [JustAnotherPU/moonride](https://github.com/JustAnotherPU/moonride) | كتالوج أصلي متاح | ID7 | 2 / 2 |
| [pllanaio/mgu-browser](https://github.com/pllanaio/mgu-browser) | كتالوج أصلي متاح | ID7 | 3 / 3 |
| [Drake1804/bube-releases](https://github.com/Drake1804/bube-releases) | كتالوج أصلي متاح | ID7 | 4 / 4 |
| [aurelmarius/bmw-games](https://github.com/aurelmarius/bmw-games) | كتالوج أصلي متاح | ID7 | 11 / 11 |
| [iAbadia/idrive-games](https://github.com/iAbadia/idrive-games) | مصدر بناء متاح | ID7 | 7 / 7 |
| [kxrxh/doodle-jump-mgu](https://github.com/kxrxh/doodle-jump-mgu) | كتالوج أصلي متاح | ID7 | 2 / 2 |
| [mistergahan/mgu-backgammon](https://github.com/mistergahan/mgu-backgammon) | مصدر بناء متاح | ID7 | 2 / 2 |
| [evangoyuk/mgu-store-apps](https://github.com/evangoyuk/mgu-store-apps) | قناة Releases أصلية موثقة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [sembsa/idrive7-ambient](https://github.com/sembsa/idrive7-ambient) | قناة Releases أصلية موثقة | غير معلن في البيانات المفحوصة | 1 / 1 |
| [NamelsMissing/mgu-apps](https://github.com/NamelsMissing/mgu-apps) | مصدر بناء متاح | ID7 | 19 / 19 |
| [istt1899/x3](https://github.com/istt1899/x3) | كتالوج أصلي متاح | ID7، ID8 | 16 / 14 |
| [MareXcodemaster/idrive7-carplay-multitouch](https://github.com/MareXcodemaster/idrive7-carplay-multitouch) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [Wallezy/mgu-setup-skills](https://github.com/Wallezy/mgu-setup-skills) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [IvanBiondi/mgu-assistant](https://github.com/IvanBiondi/mgu-assistant) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [nic0pane/mgu-unified-manager](https://github.com/nic0pane/mgu-unified-manager) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [Viaszx/BMW_HU_Info](https://github.com/Viaszx/BMW_HU_Info) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [rishik250809/bmw-idrive-controller](https://github.com/rishik250809/bmw-idrive-controller) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [IterioDev/car-apps](https://github.com/IterioDev/car-apps) | مصدر بناء متاح | ID7، ID8 | 18 / 18 |
| [rishik250809/idrive8-app-test](https://github.com/rishik250809/idrive8-app-test) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 1 / 1 |
| [istt1899/bmw-kaluga-cameras](https://github.com/istt1899/bmw-kaluga-cameras) | كتالوج أصلي متاح | ID7، ID8 | 4 / 2 |
| [jaimeen77-cmyk/idrive7-korean-patch](https://github.com/jaimeen77-cmyk/idrive7-korean-patch) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [DimonPrograms/dimonprograms-apps](https://github.com/DimonPrograms/dimonprograms-apps) | مصدر بناء متاح | ID7 | 17 / 16 |
| [DarkMuse1/idrive7-apps-ru](https://github.com/DarkMuse1/idrive7-apps-ru) | مصدر بناء متاح | ID7، ID8 | 29 / 10 |
| [kern4466/mgu-store-ua](https://github.com/kern4466/mgu-store-ua) | مرجع أو مراجعة منفصلة | ID7، ID8 | 10 / 0 |
| [eroobeeroo/idrive-apps](https://github.com/eroobeeroo/idrive-apps) | مرجع أو مراجعة منفصلة | ID7، ID8 | 4 / 1 |
| [mlurker/bmw-idrive7-releases](https://github.com/mlurker/bmw-idrive7-releases) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [BimmerGestalt/AAIdrive](https://github.com/BimmerGestalt/AAIdrive) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |
| [byakku/awesome-bmw-coding](https://github.com/byakku/awesome-bmw-coding) | مرجع أو مراجعة منفصلة | غير معلن في البيانات المفحوصة | 0 / 0 |

## مراجع لا تصبح تطبيقات MGU

| المشروع | سبب الفصل |
|---|---|
| [cauliflowermossgrape/idrive7-8-ssh-root](https://github.com/cauliflowermossgrape/idrive7-8-ssh-root) | مرجع أداة إعداد للحاسوب؛ ليست تطبيق Store داخل السيارة، ولم تُنشأ لها آلية تثبيت في هذا الجرد. |
| [kxrxh/bmw-clusters-mgu](https://github.com/kxrxh/bmw-clusters-mgu) | لم يرجع الأصل HEAD عامًا؛ طلب README أعاد 404. لا يمكن الجزم إن كان خاصًا أو محذوفًا أو منقولًا. |
| [nickgcode/idrive7-apps](https://github.com/nickgcode/idrive7-apps) | لم يرجع الأصل HEAD عامًا؛ طلب README أعاد 404. لا يمكن الجزم إن كان خاصًا أو محذوفًا أو منقولًا. |
| [MareXcodemaster/idrive7-carplay-multitouch](https://github.com/MareXcodemaster/idrive7-carplay-multitouch) | تعديل نظام خاص بإصدارات معينة؛ مرجع منفصل عن فهرس التطبيقات العامة. |
| [Wallezy/mgu-setup-skills](https://github.com/Wallezy/mgu-setup-skills) | أداة أو تعليمات تعمل على الحاسوب؛ توثق كمصدر مساعد ولا تُعرض كتطبيق MGU. |
| [IvanBiondi/mgu-assistant](https://github.com/IvanBiondi/mgu-assistant) | أداة أو تعليمات تعمل على الحاسوب؛ توثق كمصدر مساعد ولا تُعرض كتطبيق MGU. |
| [nic0pane/mgu-unified-manager](https://github.com/nic0pane/mgu-unified-manager) | أداة أو تعليمات تعمل على الحاسوب؛ توثق كمصدر مساعد ولا تُعرض كتطبيق MGU. |
| [Viaszx/BMW_HU_Info](https://github.com/Viaszx/BMW_HU_Info) | أداة أو تعليمات تعمل على الحاسوب؛ توثق كمصدر مساعد ولا تُعرض كتطبيق MGU. |
| [rishik250809/bmw-idrive-controller](https://github.com/rishik250809/bmw-idrive-controller) | مشروع متحكم وعتاد؛ ليس حزمة تطبيق داخل الوحدة. |
| [rishik250809/idrive8-app-test](https://github.com/rishik250809/idrive8-app-test) | مثال تطوير على ID8؛ وجود app.json لا يثبت وجود قناة Store مكتملة. |
| [jaimeen77-cmyk/idrive7-korean-patch](https://github.com/jaimeen77-cmyk/idrive7-korean-patch) | ترجمة مصدرية وليست تطبيقًا مستقلًا؛ الإصدار الأصلي الأحدث يملك مسار ترجمة خاصًا به. |
| [kern4466/mgu-store-ua](https://github.com/kern4466/mgu-store-ua) | نسخة بديلة تشترك بمعرفات Store ومكوناته؛ لا تُدمج فوق الناشر الأصلي تلقائيًا. |
| [eroobeeroo/idrive-apps](https://github.com/eroobeeroo/idrive-apps) | معرفات مشتركة مع المصدر الأصلي؛ تحفظ هوية الناشر ولا تُبدل الحزم حسب رقم الإصدار فقط. |
| [mlurker/bmw-idrive7-releases](https://github.com/mlurker/bmw-idrive7-releases) | لم يرجع الأصل HEAD عامًا؛ طلب README أعاد 404. لا يمكن الجزم إن كان خاصًا أو محذوفًا أو منقولًا. |
| [BimmerGestalt/AAIdrive](https://github.com/BimmerGestalt/AAIdrive) | تطبيق هاتف لمنصات NBT وNBT EVO؛ ليس حزمة تثبيت داخل MGU. |
| [byakku/awesome-bmw-coding](https://github.com/byakku/awesome-bmw-coding) | قائمة موارد مرتبطة؛ ليست تطبيقًا. |

## حدود التحقق والخطوة التنفيذية

أُنجز جلب بيانات المصدر والبيانات الوصفية من عناوين عامة، ومطابقة معرفات المشاريع والمكونات مع نقطة الأساس، والتحقق من اكتمال التغطية وعدم تكرار صفوف المستودعات. لم يشغّل هذا الجرد أي برنامج جُلب من المصادر، ولم يثبت أي حزمة على الوحدة.

ملفات size وSHA256 في الكتالوجات هي قيم الناشر إلى أن يقارنها مسار التحقق بالبايتات التي نُزلت بالفعل. يجب كذلك التحقق من غلاف الحزمة ومن الملفات التي يحتاجها البناء، ومن أن أدوات التطبيق المطلوبة تأتي من المصدر الصحيح. يظل تقرير الجرد مرجعًا للأدلة، بينما تعكس ملفات كتالوج AQ_MGU التنفيذ الذي اعتمدته المراجعة بعد هذه النقطة.

نتيجة الاختبار المحلي أو التنزيل أو وصول الحزمة إلى مرحلة التثبيت لا تستبدل دليل تسجيل التطبيق وتشغيله على HMI المطلوب. يظل حقل نتيجة الوحدة **NOT OBSERVED** إلى أن يوجد سجل فعلي لذلك التطبيق.

## مراجع النقاش الخارجي

- [Custom native iDrive 7 apps](https://g20.bimmerpost.com/forums/showthread/2260780/custom-native-idrive-7-apps/page/2) — نقاش مرجعي، ليس قناة حزم.
