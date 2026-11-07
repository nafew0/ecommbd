import {MigrationInterface, QueryRunner} from "typeorm";

export class M4ReviewFixes1793987831593 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "startedAt" TIMESTAMP(6)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "gatewayRedirectUrl" text`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_courier_booking" ADD "courierName" character varying(60)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_courier_booking" ADD "invoice" character varying(40)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_courier_booking" ADD "newCodAmount" integer`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_441cba40ce165873b510459642" ON "bd_courier_booking" ("invoice") `, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`DROP INDEX "public"."IDX_441cba40ce165873b510459642"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_courier_booking" DROP COLUMN "newCodAmount"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_courier_booking" DROP COLUMN "invoice"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_courier_booking" DROP COLUMN "courierName"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "gatewayRedirectUrl"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "startedAt"`, undefined);
   }

}
