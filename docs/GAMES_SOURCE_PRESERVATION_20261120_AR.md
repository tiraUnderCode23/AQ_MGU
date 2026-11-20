# حفظ ملفات الألعاب التاريخية — 20 نوفمبر 2026

حُفظت **26 نسخة فريدة من ملفات المصدر والتطوير والتوثيق، مجموعها 420,924 بايت** حفظًا إضافيًا تحت `archive/games-1965ef4`. استُعيدت البايتات حرفيًا من كائنات Git التاريخية، وأُرفقت أربعة ملفات ترخيص وإشعار أصلية. الملفات النشطة ووصفات المكونات لم تتغير.

- الالتزام التاريخي: `1965ef4a7736d664681542436cc7c0e8c45d316c`
- الالتزام الذي قورنت به الملفات الحالية: `2a0e23fded8aecf0b7345754ceae4da6992821b1`
- الإيصال الكامل: `data/games-source-preservation-20261120.json`
- SHA-256 لبيان ملفات الأرشيف المرتب: `b036ebd8b7b4f6534a43f06e9b087222839faf7b7270c188d05ff11262ec83ab`
- SHA-256 للإيصال: `a3c0085d5d24168ecdfc7da4240e2197f59845ac65c9976741d245ab62c8adc3`

## الحصر والتحقق

| النطاق | العدد | النتيجة |
|---|---:|---|
| مسارات Doom التاريخية الغائبة عن مواضعها الأصلية | 217 | حُفظت جميعها بالربط أو الأرشفة |
| نسخ Doom الموجودة ببايتات ووضع Git مطابقين في مواضع أخرى | 191 | سجل كامل بكل المسارات المطابقة |
| نسخ Doom الفريدة التي أُرشفت | 26 | 420,924 بايت؛ تحقق SHA-256 بعد الكتابة |
| مسارات Road Hopper المطابقة في مواضع أخرى | 15 | سجل كامل بالهوية والبصمات والوضع |
| ملفات الترخيص والإشعار المنسوخة | 4 | نسخ حرفية من الالتزام التاريخي |
| ملفات الأرشيف الإجمالية | 30 | 459,382 بايت |

تحقق الحفظ من هوية كائن Git وحجمه، ثم من SHA-256 للملف المكتوب. لكل ربط توجد هوية الملف التاريخي والتزامه ووضعه وبصمته ومسار حالي مطابق، مع فحص بايتات المسار الحالي. تحتفظ البيانات أيضًا بكل المسارات الحالية ذات البايتات ووضع Git المطابقين. لا يُعد ذلك تشغيلًا أو بناءً أو اختبارًا وظيفيًا.

## الترخيص والنسبة

قُرئت إشعارات المصدر الأصلية، وحُفظت LICENSE وNOTICE.zh-CN.md عند جذر النسخة المؤرشفة من idrive7-apps، وLICENSE وLICENSE.mgu-renderd تحت kit/renderd. توجد نصوص GPL وMIT منفصلة؛ لم يُغيّر الترخيص ولم تُنسب جميع الملفات إلى ترخيص واحد. تبقى إشعارات Road Hopper وترخيص kit/LICENSE-idrive7-apps موثقة بالربط والبصمات في الإيصال. جميع النسخ هنا مصدر أو وثائق؛ لا يحتوي الحفظ على SDK أو ناتج تثبيت جديد.

## حدود الحفظ

الأرشيف مادة تاريخية مستقلة، وليس بديلًا للمدخلات النشطة أو خدمة مثبتة. مساره يضاف إلى مدخلات توثيق وحفظ التوزيع فقط؛ لا يضاف إلى build.shared أو متطلبات التشغيل. تحفظ قاعدة Git الخاصة بالأرشيف البايتات دون تحويل نهاية السطر. حالة التشغيل لجميع المواد هي **NOT_OBSERVED**؛ لم ينفذ أي ملف مؤرشف ولم تتصل المراجعة بوحدة سيارة.

## الملفات الفريدة المؤرشفة

جميع المسارات التالية نسبية إلى الالتزام التاريخي؛ يحتفظ الأرشيف بالمسار نفسه بعد بادئة `archive/games-1965ef4/`.

| المسار الأصلي | الحجم بالبايت | وضع Git | SHA-256 |
|---|---:|---|---|
| `apps/_sources/idrive7-apps/kit/renderd/CHANGELOG.md` | 23350 | 100644 | `d491d484e59e9ce25a33b7fae994c2be08c7c7ae1c8f6165bda8c94dc5112b10` |
| `apps/_sources/idrive7-apps/kit/renderd/README.mgu-render.md` | 24049 | 100644 | `4ebae9f440f5a6531fe5acdcdb9cb1abdb1862c1b2174439bfb1ca2a7a41f91d` |
| `apps/_sources/idrive7-apps/kit/renderd/mgu-render.conf` | 5012 | 100644 | `a3879efdc9d37e53d6e716cf2245b96aba8026ef35ed71f99569961b5be4b8a6` |
| `apps/_sources/idrive7-apps/kit/renderd/src/main.c` | 94715 | 100644 | `c6e5ff38e8b336715d2d478d2db9ab4350dbaf4759e5074206e1f7925a92a5c9` |
| `apps/_sources/idrive7-apps/kit/renderd/tools/check_protocol_abi.py` | 6986 | 100755 | `e2f37daa03c1130e81dc9f49f8734da655a9f29d78c14dbdbfc3653a926c94cf` |
| `apps/_sources/idrive7-apps/kit/tools/hu-stub.js` | 23260 | 100644 | `6493c3e08f3a1087dbdcbb812f206ca6d8af0e53e584ccd2c5d300b79bf7fae5` |
| `apps/_sources/idrive7-apps/kit/tools/import_diagnostic_ru.py` | 10449 | 100644 | `a92f06423e2d267ac134941c4bf7f86f521cd8640f2c46362dcd32d461556c83` |
| `apps/_sources/idrive7-apps/kit/tools/make_gif.sh` | 2056 | 100755 | `032ac0e98ef95f06f25997978b61ea57eee60c5521c79ad2a802882123c0f060` |
| `apps/_sources/idrive7-apps/kit/tools/qrlog_decode.py` | 4908 | 100644 | `65ef2cc140730af322036432568a295dd10c87101102576928e7daf2c7c823dd` |
| `apps/_sources/idrive7-apps/kit/tools/qrlog_dict.js` | 2690 | 100644 | `26798f2fad40af680259b8d57274305154062af3e1678863b467e087c46e6048` |
| `apps/_sources/idrive7-apps/kit/tools/sync_locales.py` | 1871 | 100644 | `3a6f7ddeeb1ef1ac8dde14b937dda59f685be14bfdd97fc928592c75f68dec49` |
| `apps/_sources/idrive7-apps/kit/tools/test_ambient_lever.js` | 1983 | 100644 | `10383002b0ba9a2ef79436467b0daf6b2aff98845770f241f0652541c91101c9` |
| `apps/_sources/idrive7-apps/kit/tools/test_ambient_others.js` | 3785 | 100644 | `aee8abb9d7965bd77a895e6166f903adceac7b56752781eb7e2468f9f65d1ad1` |
| `apps/_sources/idrive7-apps/kit/tools/test_ambient_rgb.js` | 31020 | 100644 | `46a651fc99670101a6df35b185b75a232477729dda99bd7e49354db4c50d1e6f` |
| `apps/_sources/idrive7-apps/kit/tools/test_atlas_pieces.js` | 6260 | 100644 | `680c41e3e567eb1188ec7c4c2f3d1a2212220a2c5af54275c565b798548c3fdd` |
| `apps/_sources/idrive7-apps/kit/tools/test_diag_replies.js` | 15044 | 100644 | `201b3355693f2db4131bf3496ff9ea22f4345d42c457258d9d6ea76860ed25af` |
| `apps/_sources/idrive7-apps/kit/tools/test_edrive.js` | 52071 | 100644 | `0c038529f16110cc2bd8377fd0a851f044ddbe71064d6c9737a45e9b7e1fb8a8` |
| `apps/_sources/idrive7-apps/kit/tools/test_es.js` | 5366 | 100644 | `f1b3ca70ba2e0e6ebaa72bf370010414f4bcf299bab707aa82cdef260fe6d1a2` |
| `apps/_sources/idrive7-apps/kit/tools/test_es.py` | 4853 | 100644 | `1ead4d8e905c5aac5461db3128bd06dc830df67936a2b87e82690c30b9cbe8a6` |
| `apps/_sources/idrive7-apps/kit/tools/test_import_diagnostic_ru.py` | 4838 | 100644 | `f2cb30f5cfd0c7ad10f6e414d9a57aedada5dbab61e54083fbf818f844d58d61` |
| `apps/_sources/idrive7-apps/kit/tools/test_linkqueue.js` | 1660 | 100644 | `77e4b449e9a4799e9c3567ec5bc62432885b708f0dc94d3692780c9abb0fae50` |
| `apps/_sources/idrive7-apps/kit/tools/test_live_adjustments_rescan.js` | 3029 | 100644 | `9c619654b2536902ea6115736639f948c0f87317e4143cffbe5db4ead932bca3` |
| `apps/_sources/idrive7-apps/kit/tools/test_runtime.js` | 26715 | 100644 | `8030e3f3ea6d0d20b0e8e2e39a75b63c8b044ce495f1a2a52b3d5a677572f208` |
| `apps/_sources/idrive7-apps/kit/tools/test_twin_dme.js` | 53589 | 100644 | `cfdde7bc19c0ed9f27499b8e8b08d8d909373bfee9065319daaf8efcf95db939` |
| `apps/_sources/idrive7-apps/kit/tools/test_vitals_program.js` | 1989 | 100644 | `0038a593e7fd7b01f1a82d55e53ccd4b37c30a51ae4b9b3f6ba5116c84b31ed8` |
| `apps/_sources/idrive7-apps/kit/tools/test_zf8hp.js` | 9376 | 100644 | `218195b462efff7d7f10f12c85221e9081700fc3bbd86c34919a16691bee49d3` |
