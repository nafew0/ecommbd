import {MigrationInterface, QueryRunner} from "typeorm";

export class ShippingBdDeliveryFields1792567658549 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsFreedelivery" boolean NOT NULL DEFAULT false`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsDeliveryinsidedhaka" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsDeliveryoutsidedhaka" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "product" ADD "customFieldsDeliverysurcharge" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "product_variant" ADD "customFieldsWeightgrams" integer`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "product_variant" DROP COLUMN "customFieldsWeightgrams"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsDeliverysurcharge"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsDeliveryoutsidedhaka"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsDeliveryinsidedhaka"`, undefined);
        await queryRunner.query(`ALTER TABLE "product" DROP COLUMN "customFieldsFreedelivery"`, undefined);
   }

}
