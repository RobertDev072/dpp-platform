-- Productgroep per product en de EU-verificatie van het bedrijf (EU DPP-register).
--
-- 1. product_group: bepaalt of aanmelden bij het EU-register nu al aan de orde is (eerst
--    batterijen, verplicht vanaf 18 februari 2027). Geen onderdeel van de paspoortinhoud:
--    bestaande paspoorten krijgen er geen nieuwe versie door.
-- 2. eu_verified_at / eu_seal_expires_at: de verificatie in het register verloopt als het
--    identificatiemiddel (het zegel) verloopt, en uiterlijk 3 jaar na de eerste verificatie
--    (Uitvoeringsverordening (EU) 2026/1778; Battery FAQ van de Commissie, vraag 6.2).

ALTER TABLE dbo.products ADD COLUMN IF NOT EXISTS product_group varchar(20) NOT NULL DEFAULT 'unknown';
ALTER TABLE dbo.products DROP CONSTRAINT IF EXISTS chk_products_product_group;
ALTER TABLE dbo.products ADD CONSTRAINT chk_products_product_group
  CHECK (product_group IN ('battery', 'textile', 'iron_steel', 'aluminium', 'tyres', 'furniture', 'other', 'unknown'));

ALTER TABLE dbo.companies ADD COLUMN IF NOT EXISTS eu_verified_at date NULL;
ALTER TABLE dbo.companies ADD COLUMN IF NOT EXISTS eu_seal_expires_at date NULL;
