import {MigrationInterface, QueryRunner} from "typeorm";

export class BdCheckoutFields1792531644689 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsCustomernote" character varying(500)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsContactemail" character varying(254)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsLocale" character varying(5)`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsPhone" character varying(20)`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD CONSTRAINT "UQ_47d883da22de17136f6aaa8b63a" UNIQUE ("customFieldsPhone")`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsAlternatephone" character varying(20)`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsSource" character varying(16) NOT NULL DEFAULT 'web'`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsInternalnotes" text`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsOrdercount" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsDeliveredcount" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsReturnedcount" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsCancelledcount" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsTotalspent" integer NOT NULL DEFAULT '0'`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" ADD "customFieldsLastorderat" TIMESTAMP(6)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsLastorderat"`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsTotalspent"`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsCancelledcount"`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsReturnedcount"`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsDeliveredcount"`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsOrdercount"`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsInternalnotes"`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsSource"`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsAlternatephone"`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" DROP CONSTRAINT "UQ_47d883da22de17136f6aaa8b63a"`, undefined);
        await queryRunner.query(`ALTER TABLE "customer" DROP COLUMN "customFieldsPhone"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsLocale"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsContactemail"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsCustomernote"`, undefined);
   }

}
