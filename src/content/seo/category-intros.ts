import type { Locale } from "@/config/site";

// Editorial block of the top-level category pages /c/{category} (SEO audit T1, 11 Nov 2026): a
// short intro and a visible Q/A list, unique per category, rendered under the listings. No FAQPage
// JSON-LD (Google keeps that rich result for government and health sites). Categories without a
// text show nothing: no copy is shared between pages. Every claim must hold for the site as it is
// (checked against the code before merge). The carriers' Europe–Maroc departures join the services
// text once `carriersEnabled` is on. Arabic is Modern Standard Arabic awaiting a native
// review; Tarifit pages (noindex) show the French text, like the legal pages.

export interface CategoryIntro {
  intro: string;
  faq: readonly { q: string; a: string }[];
}

const FR: Readonly<Record<string, CategoryIntro>> = {
  "vehicules": {
    intro: "Voitures, motos, utilitaires, vélos, bateaux et pièces : achetez et vendez entre particuliers et professionnels partout au Maroc. Filtrez par marque, modèle, année, kilométrage, carburant et ville, et contactez le vendeur par la messagerie d'Aalan, sans afficher votre numéro. Avant d'acheter un véhicule d'occasion, demandez la carte grise, comparez l'année et le kilométrage avec l'état réel, faites essayer le véhicule et, si possible, contrôler par un mécanicien de confiance. Pour les formalités de changement de propriétaire, consultez notre guide des démarches.",
    faq: [
      { q: "Comment vendre ma voiture sur Aalan ?", a: "Déposez une annonce gratuite avec la marque, le modèle, l'année, le kilométrage, des photos nettes et un prix. Les acheteurs vous écrivent par la messagerie : votre numéro n'est affiché que si vous le choisissez." },
      { q: "Quels papiers prévoir pour acheter une voiture d'occasion ?", a: "Demandez la carte grise au nom du vendeur et vérifiez que les informations correspondent au véhicule. Le guide des démarches détaille le changement de propriétaire." },
      { q: "Puis-je louer une voiture sur Aalan ?", a: "Oui : les loueurs professionnels publient leurs véhicules, avec les conditions (caution, kilométrage, âge minimum du conducteur) affichées sur l'annonce." },
    ],
  },
  "immobilier": {
    intro: "Appartements, maisons, villas, terrains, colocations et locations de vacances : trouvez un bien à vendre ou à louer dans votre ville, ou publiez le vôtre gratuitement. Filtrez par type de bien, surface, nombre de chambres et prix, puis par quartier une fois la ville choisie. Avant de signer, visitez toujours le bien, vérifiez l'identité du vendeur ou du bailleur et la situation juridique du logement, et ne versez aucune somme avant d'avoir un écrit. Notre guide des démarches explique les vérifications et les formalités d'achat, de vente et de location.",
    faq: [
      { q: "Comment louer un appartement sur Aalan ?", a: "Parcourez les annonces de location par ville, filtrez par prix et nombre de chambres, puis écrivez au propriétaire ou à l'agence via la messagerie, sans afficher votre numéro." },
      { q: "Les agences immobilières peuvent-elles publier leurs biens ?", a: "Oui, les agences peuvent ouvrir une vitrine Pro vérifiée pour présenter leurs biens." },
      { q: "Que vérifier avant d'acheter un bien ?", a: "Visitez le bien, demandez les documents de propriété et faites vérifier leur validité. Le guide des démarches détaille les contrôles à faire avant de signer." },
    ],
  },
  "electronique": {
    intro: "Téléphones, ordinateurs, tablettes, télévisions, consoles et accessoires, neufs ou d'occasion : comparez les offres près de chez vous et contactez les vendeurs par la messagerie d'Aalan. Filtrez par marque, modèle, état et prix, et par capacité de stockage pour les téléphones, tablettes et ordinateurs. Pour un appareil d'occasion, demandez la facture ou la preuve d'achat quand elle existe, testez l'écran, la batterie et les ports en main propre, et vérifiez que l'appareil n'est pas verrouillé par un compte.",
    faq: [
      { q: "Comment vérifier un téléphone d'occasion ?", a: "Rencontrez le vendeur dans un lieu public, testez l'écran, la batterie, les boutons et le réseau, et vérifiez que l'appareil se réinitialise sans compte verrouillé." },
      { q: "Puis-je vendre mon ancien smartphone gratuitement ?", a: "Oui, le dépôt d'une annonce est gratuit pour les particuliers. Ajoutez la marque, le modèle, le stockage, l'état et des photos nettes." },
      { q: "Les boutiques d'électronique sont-elles présentes ?", a: "Oui, les professionnels peuvent ouvrir une vitrine Pro vérifiée avec leur catalogue d'offres." },
    ],
  },
  "maison-jardin": {
    intro: "Meubles, électroménager, décoration, artisanat, linge de maison, bricolage et jardin : donnez une seconde vie aux objets de la maison ou trouvez de bonnes affaires près de chez vous. Précisez l'état, les dimensions et la marque dans votre annonce, ajoutez des photos prises de plusieurs angles, et convenez avec l'acheteur de la remise en main propre. Pour les gros objets, vérifiez à l'avance l'accès (étage, ascenseur) et le moyen de transport.",
    faq: [
      { q: "Comment vendre un meuble rapidement ?", a: "Décrivez l'état et les dimensions, prenez des photos lumineuses sous plusieurs angles et fixez un prix réaliste. Les acheteurs vous écrivent par la messagerie." },
      { q: "Peut-on donner des objets gratuitement ?", a: "Oui : dans la plupart des sous-catégories, choisissez l'option « Don » au dépôt de l'annonce." },
      { q: "Que faire pour un objet trop volumineux ?", a: "Précisez dans l'annonce l'accès et le poids, et convenez avec l'acheteur d'un transport. Les services de déménagement figurent dans la catégorie Services." },
    ],
  },
  "mode": {
    intro: "Vêtements, chaussures, sacs, montres, bijoux, beauté et tenues traditionnelles (caftans, takchitas, djellabas) : vendez ce que vous ne portez plus et trouvez des pièces à prix doux. Indiquez la taille, la marque, l'état et les mesures, et photographiez l'article à plat et porté. Pour les tenues de cérémonie, précisez si le vêtement a été porté et s'il a été retouché. Rencontrez l'acheteur en lieu public pour l'essayage.",
    faq: [
      { q: "Comment vendre un caftan ou une takchita ?", a: "Choisissez la sous-catégorie Tenues traditionnelles, indiquez la taille, le tissu, l'état et le nombre de fois porté, avec des photos lumineuses du vêtement entier et des détails." },
      { q: "Comment bien décrire un vêtement d'occasion ?", a: "Donnez la marque, la taille, les mesures, l'état réel (défauts compris) et le prix. Une description honnête évite les litiges." },
      { q: "Puis-je vendre des produits de beauté ?", a: "Oui, dans la sous-catégorie Beauté et soins : décrivez le produit, sa marque et son état, et précisez s'il est neuf et scellé." },
    ],
  },
  "terroir": {
    intro: "Huile d'olive, huile d'argan alimentaire, miel, amlou, dattes, fruits secs et épices : des produits du terroir marocain proposés par des producteurs, coopératives et commerçants professionnels. Chaque annonce indique le numéro d'autorisation sanitaire ONSSA du vendeur. Comparez les origines, les conditionnements et les prix, et contactez directement le producteur par la messagerie d'Aalan.",
    faq: [
      { q: "Qui peut vendre des produits du terroir sur Aalan ?", a: "Les professionnels : l'annonce exige un numéro d'autorisation sanitaire ONSSA, affiché sur la page." },
      { q: "Comment reconnaître une huile d'olive de qualité ?", a: "Regardez la catégorie annoncée (vierge extra, vierge), l'origine, la date de récolte et le conditionnement, et demandez au producteur ses informations de traçabilité." },
      { q: "Peut-on commander en grande quantité ?", a: "Oui, de nombreux producteurs proposent des conditionnements en gros : précisez votre besoin dans votre premier message." },
    ],
  },
  "services": {
    intro: "Cours, déménagement et transport, travaux et réparations, ménage, événements et beauté : trouvez un prestataire près de chez vous ou proposez vos services. Demandez toujours un devis écrit, vérifiez les avis et les références, et convenez du prix avant le début de la prestation. Sur la vitrine d'un professionnel, les avis viennent de clients qui l'ont contacté par la messagerie d'Aalan.",
    faq: [
      { q: "Comment choisir un prestataire de confiance ?", a: "Consultez ses avis, demandez des références et un devis écrit, et ne payez pas la totalité avant la prestation." },
      { q: "Puis-je proposer mes services ?", a: "Oui : publiez une annonce dans la sous-catégorie adaptée, avec votre zone d'intervention et vos tarifs." },
    ],
  },
  "emploi": {
    intro: "Offres et demandes d'emploi partout au Maroc : consultez les postes publiés par les entreprises et les professionnels, ou publiez votre demande d'emploi. Lisez attentivement chaque offre, méfiez-vous de toute demande de paiement pour obtenir un poste, et ne communiquez jamais de documents d'identité avant d'avoir vérifié l'employeur. Précisez dans votre annonce le poste, la ville, le type de contrat et la rémunération quand elle est connue.",
    faq: [
      { q: "Comment publier une offre d'emploi ?", a: "Avec un compte Pro, déposez une annonce dans Offres d'emploi avec le poste, la ville, le type de contrat et les missions. Les candidats vous écrivent par la messagerie." },
      { q: "Comment repérer une fausse offre d'emploi ?", a: "Méfiez-vous des offres qui demandent de l'argent, promettent un salaire irréaliste ou exigent vos documents d'identité d'emblée. Signalez-les avec le bouton Signaler." },
      { q: "Puis-je publier ma demande d'emploi ?", a: "Oui, dans Demandes d'emploi : indiquez votre profil, votre ville et votre disponibilité, sans donner d'informations personnelles inutiles." },
    ],
  },
};

const AR: Readonly<Record<string, CategoryIntro>> = {
  "vehicules": {
    intro: "سيارات ودراجات نارية وشاحنات نفعية ودراجات هوائية وقوارب وقطع غيار: بيع وشراء بين الأفراد والمهنيين في كل مدن المغرب. صفّ النتائج حسب الماركة والطراز وسنة الصنع وعدد الكيلومترات ونوع الوقود والمدينة، وتواصل مع البائع عبر مراسلة أعلان دون كشف رقم هاتفك. قبل شراء مركبة مستعملة، اطلب البطاقة الرمادية، وقارن السنة وعدد الكيلومترات بحالة المركبة الفعلية، وجرّبها، ويُستحسن أن يفحصها ميكانيكي تثق به. لإجراءات تغيير المالك، راجع دليل المساطر الإدارية.",
    faq: [
      { q: "كيف أبيع سيارتي على أعلان؟", a: "أضف إعلانًا مجانيًا يتضمن الماركة والطراز وسنة الصنع وعدد الكيلومترات وصورًا واضحة وثمنًا. يراسلك المشترون عبر الرسائل، ولا يظهر رقم هاتفك إلا إذا اخترت ذلك." },
      { q: "ما الوثائق اللازمة لشراء سيارة مستعملة؟", a: "اطلب البطاقة الرمادية باسم البائع وتأكد من تطابق بياناتها مع المركبة. يشرح دليل المساطر الإدارية كيفية تغيير المالك." },
      { q: "هل يمكنني كراء سيارة عبر أعلان؟", a: "نعم، يعرض مهنيو كراء السيارات مركباتهم مع الشروط (الضمانة وعدد الكيلومترات والسن الأدنى للسائق) في الإعلان." },
    ],
  },
  "immobilier": {
    intro: "شقق ومنازل وفيلات وأراضٍ وسكن مشترك وكراء للعطل: اعثر على عقار للبيع أو الكراء في مدينتك، أو انشر عقارك مجانًا. صفّ النتائج حسب نوع العقار والمساحة وعدد الغرف والثمن، ثم حسب الحي بعد اختيار المدينة. قبل التوقيع، قم دائمًا بزيارة العقار، وتحقق من هوية البائع أو المكري ومن الوضعية القانونية للعقار، ولا تدفع أي مبلغ قبل الحصول على وثيقة مكتوبة. يشرح دليل المساطر الإدارية التحققات والإجراءات المتعلقة بالشراء والبيع والكراء.",
    faq: [
      { q: "كيف أكتري شقة عبر أعلان؟", a: "تصفح إعلانات الكراء حسب المدينة، وصفّها حسب الثمن وعدد الغرف، ثم راسل المالك أو الوكالة عبر الرسائل دون إظهار رقم هاتفك." },
      { q: "هل يمكن للوكالات العقارية نشر عقاراتها؟", a: "نعم، يمكن للوكالات فتح واجهة احترافية موثقة لعرض عقاراتها." },
      { q: "ماذا أتحقق منه قبل شراء عقار؟", a: "قم بزيارة العقار، واطلب وثائق الملكية وتحقق من صحتها. يوضح دليل المساطر الإدارية ما ينبغي فحصه قبل التوقيع." },
    ],
  },
  "electronique": {
    intro: "هواتف وحواسيب وأجهزة لوحية وتلفازات وأجهزة ألعاب وإكسسوارات، جديدة أو مستعملة: قارن العروض القريبة منك وتواصل مع البائعين عبر مراسلة أعلان. صفّ النتائج حسب الماركة والطراز والحالة والثمن، وحسب سعة التخزين للهواتف والأجهزة اللوحية والحواسيب. عند شراء جهاز مستعمل، اطلب الفاتورة أو إثبات الشراء إن وُجد، وجرّب الشاشة والبطارية والمنافذ بنفسك، وتأكد من أن الجهاز غير مقفل بحساب.",
    faq: [
      { q: "كيف أتحقق من هاتف مستعمل؟", a: "قابل البائع في مكان عام، وجرّب الشاشة والبطارية والأزرار والشبكة، وتأكد أن الجهاز يمكن إعادة ضبطه دون حساب مقفل." },
      { q: "هل يمكنني بيع هاتفي القديم مجانًا؟", a: "نعم، نشر الإعلان مجاني للأفراد. أضف الماركة والطراز والتخزين والحالة وصورًا واضحة." },
      { q: "هل توجد متاجر للإلكترونيات؟", a: "نعم، يمكن للمهنيين فتح واجهة احترافية موثقة مع كتالوج عروضهم." },
    ],
  },
  "maison-jardin": {
    intro: "أثاث وأجهزة منزلية وديكور وصناعة تقليدية ومفروشات وأدوات وعدد وحديقة: امنح أغراض المنزل حياة ثانية أو اعثر على صفقات جيدة بالقرب منك. اذكر الحالة والأبعاد والماركة في إعلانك، وأضف صورًا من زوايا متعددة، واتفق مع المشتري على التسليم يدًا بيد. بالنسبة للأغراض الكبيرة، تحقق مسبقًا من سهولة الوصول (الطابق والمصعد) ووسيلة النقل.",
    faq: [
      { q: "كيف أبيع قطعة أثاث بسرعة؟", a: "صف الحالة والأبعاد، والتقط صورًا مضيئة من زوايا مختلفة، وحدد ثمنًا واقعيًا. يراسلك المشترون عبر الرسائل." },
      { q: "هل يمكن التبرع بالأغراض مجانًا؟", a: "نعم: في أغلب الأصناف، اختر خيار «تبرع» عند نشر الإعلان." },
      { q: "ماذا أفعل مع غرض كبير الحجم؟", a: "اذكر في الإعلان سهولة الوصول والوزن، واتفق مع المشتري على النقل. تجد خدمات الترحيل في فئة الخدمات." },
    ],
  },
  "mode": {
    intro: "ملابس وأحذية وحقائب وساعات ومجوهرات وتجميل وملابس تقليدية (قفاطن وتكاشيط وجلابيب): بع ما لم تعد ترتديه واعثر على قطع بأسعار مناسبة. اذكر المقاس والماركة والحالة والقياسات، وصوّر القطعة مسطحة ومرتداة. بالنسبة للأزياء الخاصة بالمناسبات، وضّح ما إذا كانت قد ارتُديت أو عُدّلت. قابل المشتري في مكان عام للتجربة.",
    faq: [
      { q: "كيف أبيع قفطانًا أو تكشيطة؟", a: "اختر صنف الملابس التقليدية، واذكر المقاس والقماش والحالة وعدد مرات الارتداء، مع صور مضيئة للقطعة كاملة وللتفاصيل." },
      { q: "كيف أصف ملابس مستعملة جيدًا؟", a: "اذكر الماركة والمقاس والقياسات والحالة الفعلية بما فيها العيوب والثمن. الوصف الصادق يتجنب النزاعات." },
      { q: "هل يمكنني بيع مواد التجميل؟", a: "نعم، في صنف التجميل والعناية: صف المنتج وماركته وحالته، ووضّح ما إذا كان جديدًا ومغلقًا." },
    ],
  },
  "terroir": {
    intro: "زيت الزيتون وزيت أركان الغذائي والعسل وأملو والتمور والفواكه الجافة والتوابل: منتجات مجالية مغربية يعرضها منتجون وتعاونيات وتجار محترفون. يذكر كل إعلان رقم الترخيص الصحي للبائع لدى المكتب الوطني للسلامة الصحية للمنتجات الغذائية. قارن بين الأصول والتعبئة والأثمان، وتواصل مباشرة مع المنتج عبر مراسلة أعلان.",
    faq: [
      { q: "من يمكنه بيع المنتجات المجالية على أعلان؟", a: "المهنيون: يشترط الإعلان رقم ترخيص المكتب الوطني للسلامة الصحية للمنتجات الغذائية، ويظهر في الصفحة." },
      { q: "كيف أميز زيت زيتون جيدًا؟", a: "انظر إلى الصنف المعلن (بكر ممتاز، بكر)، والأصل وتاريخ الجني والتعبئة، واطلب من المنتج معلومات التتبع." },
      { q: "هل يمكن الطلب بكميات كبيرة؟", a: "نعم، يقدم كثير من المنتجين تعبئة بالجملة: حدد حاجتك في رسالتك الأولى." },
    ],
  },
  "services": {
    intro: "دروس ونقل وترحيل وأشغال وإصلاحات وتنظيف وحفلات ومناسبات وتجميل: اعثر على مقدم خدمة قريب منك أو اعرض خدماتك. اطلب دائمًا عرض ثمن مكتوبًا، وتحقق من التقييمات والمراجع، واتفق على الثمن قبل بدء الخدمة. في واجهة المهني، تأتي التقييمات من زبناء تواصلوا معه عبر مراسلة أعلان.",
    faq: [
      { q: "كيف أختار مقدم خدمة موثوقًا؟", a: "اطلع على تقييماته، واطلب مراجع وعرض ثمن مكتوبًا، ولا تدفع المبلغ كاملًا قبل الخدمة." },
      { q: "هل يمكنني عرض خدماتي؟", a: "نعم: انشر إعلانًا في الصنف المناسب مع منطقة تدخلك وأثمانك." },
    ],
  },
  "emploi": {
    intro: "عروض وطلبات عمل في كل أنحاء المغرب: اطلع على المناصب التي تنشرها المقاولات والمهنيون، أو انشر طلب عمل. اقرأ كل عرض بعناية، واحذر من أي طلب أداء مبلغ مقابل الحصول على منصب، ولا تسلّم وثائق هويتك قبل التحقق من المشغّل. اذكر في إعلانك المنصب والمدينة ونوع العقد والأجر إن كان معروفًا.",
    faq: [
      { q: "كيف أنشر عرض عمل؟", a: "بحساب احترافي، أضف إعلانًا في عروض العمل مع المنصب والمدينة ونوع العقد والمهام. يراسلك المرشحون عبر الرسائل." },
      { q: "كيف أكتشف عرض عمل مزيفًا؟", a: "احذر العروض التي تطلب مالًا أو تعد بأجر غير واقعي أو تطلب وثائق هويتك مباشرة. بلّغ عنها بزر الإبلاغ." },
      { q: "هل يمكنني نشر طلب عمل؟", a: "نعم، في طلبات العمل: اذكر ملفك ومدينتك وتوفرك دون معلومات شخصية غير ضرورية." },
    ],
  },
};

/** The category's editorial block in the page language, or null when it has none. */
export function categoryIntro(locale: Locale, category: string): CategoryIntro | null {
  const texts = locale === "ar" ? AR : FR;
  return Object.hasOwn(texts, category) ? (texts[category] ?? null) : null;
}

/** Categories carrying a text (tests). */
export const CATEGORY_INTRO_IDS: readonly string[] = Object.keys(FR);
