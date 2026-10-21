import {MigrationInterface, QueryRunner} from "typeorm";

export class BdManualOrders1792572782596 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsDeliverychargeoverride" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsSource" character varying(20) NOT NULL DEFAULT 'web'`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsSendsms" boolean NOT NULL DEFAULT true`, undefined);
        await queryRunner.query(`ALTER TABLE "order_line" ADD "customFieldsPriceoverride" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "order_line" ADD "customFieldsOriginalunitprice" integer`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order_line" DROP COLUMN "customFieldsOriginalunitprice"`, undefined);
        await queryRunner.query(`ALTER TABLE "order_line" DROP COLUMN "customFieldsPriceoverride"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsSendsms"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsSource"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsDeliverychargeoverride"`, undefined);
   }

}
