import {MigrationInterface, QueryRunner} from "typeorm";

export class BkashV21792944083341 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "gatewaySignature" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "executeSentAt" TIMESTAMP(6)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "maxRefundableAmount" integer`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "payerAccount" character varying(20)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "failureMessageEn" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "failureMessageBn" character varying(255)`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" ADD "refundRequestedAt" TIMESTAMP(6)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "refundRequestedAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "failureMessageBn"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "failureMessageEn"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "payerAccount"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "maxRefundableAmount"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "executeSentAt"`, undefined);
        await queryRunner.query(`ALTER TABLE "bd_payment_attempt" DROP COLUMN "gatewaySignature"`, undefined);
   }

}
