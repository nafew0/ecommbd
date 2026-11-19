import {MigrationInterface, QueryRunner} from "typeorm";

export class AddProductDepth1795032992491 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "facet_value_translation" ADD "customFields__fix_relational_custom_fields__" boolean`, undefined);
        await queryRunner.query(`COMMENT ON COLUMN "facet_value_translation"."customFields__fix_relational_custom_fields__" IS 'A work-around needed when only relational custom fields are defined on an entity'`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_value_translation" ADD "customFieldsDescription" text`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_value" ADD "customFields__fix_relational_custom_fields__" boolean`, undefined);
        await queryRunner.query(`COMMENT ON COLUMN "facet_value"."customFields__fix_relational_custom_fields__" IS 'A work-around needed when only relational custom fields are defined on an entity'`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_value" ADD "customFieldsLogoid" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsStatus" character varying(16)`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsTrashedat" TIMESTAMP(6)`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsUnit" character varying(40)`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsShippingclass" character varying(40)`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" ADD "customFieldsLengthcm" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" ADD "customFieldsWidthcm" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" ADD "customFieldsHeightcm" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_value" ADD CONSTRAINT "FK_24520ae6d8407213213c9c2dbfd" FOREIGN KEY ("customFieldsLogoid") REFERENCES "asset"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "facet_value" DROP CONSTRAINT "FK_24520ae6d8407213213c9c2dbfd"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" DROP COLUMN "customFieldsHeightcm"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" DROP COLUMN "customFieldsWidthcm"`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" DROP COLUMN "customFieldsLengthcm"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsShippingclass"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsUnit"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsTrashedat"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsStatus"`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_value" DROP COLUMN "customFieldsLogoid"`, undefined);
        await queryRunner.query(`COMMENT ON COLUMN "facet_value"."customFields__fix_relational_custom_fields__" IS 'A work-around needed when only relational custom fields are defined on an entity'`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_value" DROP COLUMN "customFields__fix_relational_custom_fields__"`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_value_translation" DROP COLUMN "customFieldsDescription"`, undefined);
        await queryRunner.query(`COMMENT ON COLUMN "facet_value_translation"."customFields__fix_relational_custom_fields__" IS 'A work-around needed when only relational custom fields are defined on an entity'`, undefined);
        await queryRunner.query(`ALTER TABLE "facet_value_translation" DROP COLUMN "customFields__fix_relational_custom_fields__"`, undefined);
   }

}
