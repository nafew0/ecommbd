import {MigrationInterface, QueryRunner} from "typeorm";

export class MetaCapi1792832292465 implements MigrationInterface {

   public async up(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`CREATE TABLE "bd_meta_event" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "pixelId" character varying(20) NOT NULL, "eventName" character varying(30) NOT NULL, "eventId" character varying(80) NOT NULL, "source" character varying(10) NOT NULL, "orderId" integer, "status" character varying(10) NOT NULL, "eventTime" TIMESTAMP(6) NOT NULL, "payload" jsonb NOT NULL, "clientIp" character varying(64), "userAgent" character varying(400), "attempts" integer NOT NULL DEFAULT '0', "nextAttemptAt" TIMESTAMP(6), "sentAt" TIMESTAMP(6), "response" jsonb, "error" character varying(500), "id" SERIAL NOT NULL, CONSTRAINT "UQ_8a4d45fd9ccaaff7bdd8af747a5" UNIQUE ("pixelId", "eventId"), CONSTRAINT "PK_e294daecc6f0575b48e55d1039f" PRIMARY KEY ("id"))`, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_4266ad53472fca9dda0a934e59" ON "bd_meta_event" ("pixelId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_f9008fd554c24c555a6901dfe8" ON "bd_meta_event" ("eventName") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_caa56d273dbe72df9c32b83f2e" ON "bd_meta_event" ("orderId") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_7d41e88c8ba34b49a71b7fac2c" ON "bd_meta_event" ("status") `, undefined);
        await queryRunner.query(`CREATE INDEX "IDX_03693a348a44bc8851ce214147" ON "bd_meta_event" ("nextAttemptAt") `, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsMetafbp" character varying(60)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsMetafbc" character varying(600)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsMetaclientip" character varying(64)`, undefined);
        await queryRunner.query(`ALTER TABLE "order" ADD "customFieldsMetauseragent" character varying(400)`, undefined);
   }

   public async down(queryRunner: QueryRunner): Promise<any> {
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsMetauseragent"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsMetaclientip"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsMetafbc"`, undefined);
        await queryRunner.query(`ALTER TABLE "order" DROP COLUMN "customFieldsMetafbp"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_03693a348a44bc8851ce214147"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_7d41e88c8ba34b49a71b7fac2c"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_caa56d273dbe72df9c32b83f2e"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_f9008fd554c24c555a6901dfe8"`, undefined);
        await queryRunner.query(`DROP INDEX "public"."IDX_4266ad53472fca9dda0a934e59"`, undefined);
        await queryRunner.query(`DROP TABLE "bd_meta_event"`, undefined);
   }

}
