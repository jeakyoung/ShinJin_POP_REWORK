package com.shinjin.pop.output;

import com.shinjin.pop.admin.TerminalSettingsDemoController;
import com.shinjin.pop.history.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.ObjectMapper;

@Profile("demo")
@RestController
@RequestMapping("/api/demo/employee-print")
public class EmployeePrintController {
    private static final String SESSION = EmployeePrintController.class.getName();
    public record Choice(String code, String name) {}
    public record Employee(String plant, int no, String department, String departmentName,
                           String id, String name, boolean checked) {}
    public record Roster(List<Choice> plants, List<Employee> employees) {}
    public record Password(String password) {}
    public record Access(UUID entry, List<Choice> plants) {}
    public record Listing(List<Choice> departments, List<Employee> employees) {}
    public enum Form { QR, BARCODE }
    public record Selection(String plant, String department, List<String> ids, Form form) {}
    public record Document(UUID id, int pages, String printer, UUID printKey, boolean diagnostic) {}
    public record PrintRequest(UUID key, Integer copies) {}
    public record Receipt(UUID key, String printer, int pages, Integer copies, UUID nextKey) {}
    private static class Entry {
        final UUID id = UUID.randomUUID();
        List<byte[]> pages = List.of();
        UUID document;
        DemoReportPrinter.Preview preview;
        UUID printKey;
        Receipt receipt;
    }

    private final Roster roster;
    private final String password;
    private final boolean diagnostic;
    private final EmployeeReportRenderer renderer;
    private final TerminalSettingsDemoController settings;

    public EmployeePrintController(ObjectMapper mapper, TerminalSettingsDemoController settings,
            EmployeeReportRenderer renderer,
            @Value("${shinjin.demo.employee-print-roster:classpath:employee-print/roster.json}") Resource resource,
            @Value("${shinjin.demo.employee-print-password:}") String password,
            @Value("${shinjin.demo.employee-print-submit:false}") boolean diagnostic) throws IOException {
        this.settings = settings;
        this.password = password;
        this.diagnostic = diagnostic;
        this.renderer = renderer;
        try (var stream = resource.getInputStream()) {
            roster = mapper.readValue(stream, Roster.class);
        }
    }

    @ModelAttribute
    void protect(HttpServletRequest request, HttpServletResponse response) {
        response.setHeader("Cache-Control", "no-store");
        DemoSessionController.requireIdentity(request);
    }

    @PostMapping("/entry")
    public Access enter(@RequestBody Password input, HttpServletRequest request) {
        if (password.isEmpty() || input.password() == null || !MessageDigest.isEqual(
                input.password().getBytes(StandardCharsets.UTF_8), password.getBytes(StandardCharsets.UTF_8)))
            throw error(HttpStatus.FORBIDDEN);
        var entry = new Entry();
        var session = request.getSession(false);
        synchronized (session) { session.setAttribute(SESSION, entry); }
        return new Access(entry.id, roster.plants());
    }

    private Entry active(HttpServletRequest request) {
        Object value = request.getSession(false).getAttribute(SESSION);
        if (!(value instanceof Entry entry) || !entry.id.toString().equals(request.getHeader("X-Employee-Entry")))
            throw error(HttpStatus.FORBIDDEN);
        return entry;
    }

    @DeleteMapping("/entry")
    public void leave(HttpServletRequest request) {
        var session = request.getSession(false);
        synchronized (session) {
            active(request);
            session.removeAttribute(SESSION);
        }
    }

    @GetMapping("/employees")
    public Listing employees(@RequestParam String plant, @RequestParam(defaultValue = "") String department,
                             HttpServletRequest request) {
        active(request);
        return listing(plant, department);
    }

    private Listing listing(String plant, String department) {
        if (roster.plants().stream().noneMatch(p -> p.code().equals(plant))) throw error(HttpStatus.BAD_REQUEST);
        var rows = roster.employees().stream().filter(e -> e.plant().equals(plant)).toList();
        var choices = new ArrayList<Choice>();
        choices.add(new Choice("000", "전체"));
        rows.stream().map(e -> new Choice(e.department(), e.departmentName())).distinct()
                .sorted(Comparator.comparing(Choice::code)).forEach(choices::add);
        return new Listing(choices, rows.stream().filter(e -> department.isEmpty() || department.equals("000")
                || department.equals(e.department())).toList());
    }

    @PostMapping("/preview")
    public Document preview(@RequestBody Selection selection, HttpServletRequest request) {
        var entry = active(request);
        if (selection.ids() == null || selection.ids().isEmpty() || selection.form() == null)
            throw error(HttpStatus.BAD_REQUEST);
        var rows = listing(selection.plant(), Objects.toString(selection.department(), "")).employees();
        var selected = rows.stream().filter(e -> selection.ids().contains(e.id())).toList();
        if (selected.size() != selection.ids().size()) throw error(HttpStatus.BAD_REQUEST);
        String plantName = roster.plants().stream().filter(p -> p.code().equals(selection.plant()))
                .findFirst().orElseThrow().name();
        var rendered = renderer.render(selection.form(), plantName, selected);
        int pages = rendered.size();
        var view = terminalSettings(request);
        String printer = view == null ? "" : view.applied().values().outputs().get("document");
        var form = selection.form() == Form.QR ? DemoReportPrinter.ManualForm.EMPLOYEE_QR
                : DemoReportPrinter.ManualForm.EMPLOYEE_BARCODE;
        synchronized (entry) {
            entry.pages = rendered;
            entry.document = UUID.randomUUID();
            var adapter = new DemoReportPrinter(call -> { throw new IllegalStateException("Preview submitted a print job"); });
            entry.preview = adapter.openPreview(new DemoReportPrinter.Devices(printer, null), form, pages);
            entry.printKey = UUID.randomUUID();
            entry.receipt = null;
            return new Document(entry.document, pages, entry.preview.device(), entry.printKey, diagnostic);
        }
    }

    @GetMapping(value = "/preview/{id}/{page}", produces = "image/svg+xml")
    public byte[] page(@PathVariable UUID id, @PathVariable int page, HttpServletRequest request) throws IOException {
        var entry = active(request);
        synchronized (entry) {
            if (!id.equals(entry.document) || page < 1 || page > entry.preview.documentPages())
                throw error(HttpStatus.NOT_FOUND);
            return entry.pages.get(page - 1);
        }
    }

    @DeleteMapping("/preview/{id}")
    public void close(@PathVariable UUID id, HttpServletRequest request) {
        var entry = active(request);
        synchronized (entry) {
            if (id.equals(entry.document)) {
                entry.document = null;
                entry.preview = null;
                entry.pages = List.of();
                entry.receipt = null;
            }
        }
    }

    @PostMapping("/preview/{id}/print")
    public Receipt print(@PathVariable UUID id, @RequestBody PrintRequest input, HttpServletRequest request) {
        var entry = active(request);
        if (!diagnostic) throw error(HttpStatus.FORBIDDEN);
        synchronized (entry) {
            if (!id.equals(entry.document)) throw error(HttpStatus.NOT_FOUND);
            if (input.key() == null || (input.copies() != null && input.copies() <= 0)) throw error(HttpStatus.BAD_REQUEST);
            if (entry.receipt != null && entry.receipt.key().equals(input.key())) {
                if (!Objects.equals(input.copies(), entry.receipt.copies())) throw error(HttpStatus.CONFLICT);
                return entry.receipt;
            }
            if (!input.key().equals(entry.printKey)) throw error(HttpStatus.CONFLICT);
            var view = terminalSettings(request);
            String device = entry.preview.device();
            if (view == null || device == null || device.isBlank() || "NONE".equals(device)
                    || !device.equals(view.applied().values().outputs().get("document"))
                    || !view.catalog().printers().contains(device)) {
                throw error(HttpStatus.valueOf(422));
            }
            var adapter = new DemoReportPrinter(call -> {
                entry.printKey = UUID.randomUUID();
                entry.receipt = new Receipt(input.key(), call.device(), call.documentPages(),
                        call.copies().isPresent() ? call.copies().getAsInt() : null, entry.printKey);
            });
            adapter.printFromPreview(entry.preview, input.copies() == null ? OptionalInt.empty() : OptionalInt.of(input.copies()));
            return entry.receipt;
        }
    }

    private TerminalSettingsDemoController.View terminalSettings(HttpServletRequest request) {
        var identity = DemoSessionController.requireIdentity(request);
        var reply = settings.read(identity.terminal().id(), request).getBody();
        return reply == null ? null : reply.view();
    }

    private static ResponseStatusException error(HttpStatus status) { return new ResponseStatusException(status); }
}
