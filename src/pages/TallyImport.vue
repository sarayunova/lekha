<template>
  <div class="flex flex-col overflow-hidden w-full">
    <PageHeader :title="t`Import from Tally`">
      <Button
        v-if="!result"
        :title="t`Add File`"
        :disabled="importing"
        @click="selectFile"
      >
        {{ files.length ? t`Add File` : t`Select File` }}
      </Button>
      <Button
        v-if="files.length && !result"
        :title="t`Import Data`"
        type="primary"
        :disabled="importing"
        @click="importData"
      >
        {{ t`Import Data` }}
      </Button>
      <Button v-if="result" type="primary" @click="clear">
        {{ t`Done` }}
      </Button>
    </PageHeader>

    <div
      class="
        flex flex-col
        gap-4
        p-4
        text-base
        overflow-auto
        custom-scroll custom-scroll-thumb1
        dark:text-gray-200
      "
    >
      <div v-if="!files.length" class="max-w-2xl flex flex-col gap-2">
        <p>
          {{
            t`Bring your masters, opening balances and vouchers over from Tally.`
          }}
        </p>
        <p class="text-gray-600 dark:text-gray-400">
          {{
            t`In Tally, open Display More Reports > List of Accounts (for masters) or Day Book (for vouchers), press Export, choose XML (Data Interchange) and select the exported files here. Masters must be added before vouchers that use them.`
          }}
        </p>
      </div>

      <div v-if="files.length" class="max-w-2xl flex flex-col gap-2">
        <p class="font-semibold">{{ t`Selected Files` }}</p>
        <ul class="list-disc ps-6">
          <li v-for="file of files" :key="file">{{ file }}</li>
        </ul>

        <table class="mt-2 w-80">
          <tbody>
            <tr
              v-for="row of summary"
              :key="row.label"
              class="border-b dark:border-gray-800"
            >
              <td class="py-1">{{ row.label }}</td>
              <td class="py-1 text-end">{{ row.value }}</td>
            </tr>
          </tbody>
        </table>

        <p class="text-gray-600 dark:text-gray-400 mt-2">
          {{
            t`Parties are created from Sundry Debtors and Sundry Creditors, other ledgers become accounts, and vouchers are posted as journal entries. Imported sales and purchase vouchers will not appear in GST returns.`
          }}
        </p>
      </div>

      <div v-if="importing" class="max-w-2xl flex flex-col gap-2">
        <p>{{ t`Importing... ${progress} of ${total} vouchers` }}</p>
        <div class="w-full h-2 rounded bg-gray-200 dark:bg-gray-800">
          <div
            class="h-2 rounded bg-blue-500"
            :style="{ width: `${total ? (progress / total) * 100 : 0}%` }"
          />
        </div>
      </div>

      <div v-if="result" class="max-w-2xl flex flex-col gap-2">
        <p class="font-semibold">{{ t`Import Complete` }}</p>
        <table class="w-80">
          <tbody>
            <tr
              v-for="row of resultSummary"
              :key="row.label"
              class="border-b dark:border-gray-800"
            >
              <td class="py-1">{{ row.label }}</td>
              <td class="py-1 text-end">{{ row.value }}</td>
            </tr>
          </tbody>
        </table>

        <div v-if="result.errors.length" class="mt-2">
          <p class="font-semibold text-red-600">
            {{ t`${result.errors.length} errors` }}
          </p>
          <ul class="list-disc ps-6 text-red-600">
            <li v-for="(error, i) of result.errors" :key="i">{{ error }}</li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>
<script lang="ts">
import Button from 'src/components/Button.vue';
import PageHeader from 'src/components/PageHeader.vue';
import { fyo } from 'src/initFyo';
import {
  importTallyData,
  TallyImportResult,
} from 'src/regional/in/tally/importer';
import {
  decodeTallyFile,
  parseTallyXML,
  TallyData,
} from 'src/regional/in/tally/parser';
import { showToast } from 'src/utils/interactive';
import { defineComponent } from 'vue';

export default defineComponent({
  components: { PageHeader, Button },
  data() {
    return {
      files: [] as string[],
      data: null as TallyData | null,
      importing: false,
      progress: 0,
      total: 0,
      result: null as TallyImportResult | null,
    };
  },
  computed: {
    summary(): { label: string; value: number }[] {
      const data = this.data;
      if (!data) {
        return [];
      }

      return [
        { label: this.t`Groups`, value: data.groups.length },
        { label: this.t`Ledgers`, value: data.ledgers.length },
        { label: this.t`Stock Items`, value: data.stockItems.length },
        { label: this.t`Vouchers`, value: data.vouchers.length },
        {
          label: this.t`Cancelled or Optional Vouchers`,
          value: data.skippedVouchers,
        },
      ];
    },
    resultSummary(): { label: string; value: number | string }[] {
      const result = this.result;
      if (!result) {
        return [];
      }

      return [
        { label: this.t`Accounts Created`, value: result.accounts },
        { label: this.t`Parties Created`, value: result.parties },
        { label: this.t`Items Created`, value: result.items },
        {
          label: this.t`Opening Balances`,
          value: result.openingEntry ? this.t`Posted` : '-',
        },
        { label: this.t`Vouchers Posted`, value: result.vouchers },
        { label: this.t`Already Imported`, value: result.duplicates },
      ];
    },
  },
  methods: {
    async selectFile() {
      const { success, canceled, data, name } = await ipc.selectFile({
        title: this.t`Select Tally XML File`,
        filters: [{ name: 'Tally XML', extensions: ['xml'] }],
      });

      if (canceled || !success) {
        return;
      }

      try {
        const parsed = parseTallyXML(decodeTallyFile(new Uint8Array(data)));
        this.data = mergeData(this.data, parsed);
        this.files.push(name);
      } catch (error) {
        showToast({
          type: 'error',
          message: this.t`Could not read ${name ?? ''}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    },
    async importData() {
      if (!this.data || this.importing) {
        return;
      }

      this.importing = true;
      this.progress = 0;
      this.total = this.data.vouchers.length;
      try {
        this.result = await importTallyData(fyo, this.data, (done) => {
          this.progress = done;
        });
      } finally {
        this.importing = false;
      }
    },
    clear() {
      this.files = [];
      this.data = null;
      this.result = null;
      this.progress = 0;
      this.total = 0;
    },
  },
});

function mergeData(existing: TallyData | null, data: TallyData): TallyData {
  if (!existing) {
    return data;
  }

  return {
    companyName: existing.companyName || data.companyName,
    booksFrom: existing.booksFrom || data.booksFrom,
    groups: [...existing.groups, ...data.groups],
    ledgers: [...existing.ledgers, ...data.ledgers],
    units: [...existing.units, ...data.units],
    stockItems: [...existing.stockItems, ...data.stockItems],
    voucherTypes: { ...existing.voucherTypes, ...data.voucherTypes },
    vouchers: [...existing.vouchers, ...data.vouchers],
    skippedVouchers: existing.skippedVouchers + data.skippedVouchers,
  };
}
</script>
