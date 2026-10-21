import {MigrationInterface, QueryRunner} from "typeorm";

export class PaymentsBdFields1792569242758 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "payment" ADD "customFieldsMfsreference" character varying(40)`, undefined);
        await queryRunner.query(`ALTER TABLE "payment" ADD CONSTRAINT "UQ_c9d5f8962382c617d47db7b1d13" UNIQUE ("customFieldsMfsreference")`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsPaymentchoice" character varying(16)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsPaymentchoice"`, undefined);
        await queryRunner.query(`ALTER TABLE "payment" DROP CONSTRAINT "UQ_c9d5f8962382c617d47db7b1d13"`, undefined);
        await queryRunner.query(`ALTER TABLE "payment" DROP COLUMN "customFieldsMfsreference"`, undefined);
   }

}
