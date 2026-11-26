package com.shinjin.pop.admin;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.*;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.*;
import java.util.function.Function;
import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

import static java.nio.file.StandardOpenOption.*;

/** Browser-owned local settings. The cookie conveys no employee or administrator authority. */
@Component
@Profile("demo")
public final class PreloginDetailStore {
    private static final String COOKIE = "POP_LOCAL_SETTINGS";
    private static final String PENDING = PreloginDetailStore.class.getName()+".issued";
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Object FILE_LOCK = new Object();
    private static final JsonMapper JSON = JsonMapper.builder().build();
    private final Path file;

    public record LocalPin(Map<Integer,String> slots, List<String> materials, Map<String,List<String>> warehouses) {
        public LocalPin {
            slots = slots == null ? null : Map.copyOf(slots);
            materials = materials == null ? null : List.copyOf(materials);
            if (warehouses != null) {
                Map<String,List<String>> copy = new LinkedHashMap<>();
                warehouses.forEach((k,v)->copy.put(k,List.copyOf(v)));
                warehouses = copy.values().stream().allMatch(List::isEmpty) ? Map.of() : Map.copyOf(copy);
            }
        }
    }
    record Key(String browser, String terminal, String plant, String center) {}
    record Entry(Key key, long version, LocalPin pin, Boolean machineReady, Map<String,tools.jackson.databind.JsonNode> sections) {
        Entry {sections=sections==null ? Map.of() : Map.copyOf(sections);}
    }
    record Document(int format, List<Entry> entries) {}
    private static final LocalPin EMPTY = new LocalPin(null,null,null);

    public PreloginDetailStore(Environment env) {
        String configured = env.getProperty("shinjin.prelogin.local-store","");
        String local = System.getenv("LOCALAPPDATA");
        Path home = local == null || local.isBlank() ? Path.of(System.getProperty("user.home"),".local","share") : Path.of(local);
        file = (configured.isBlank() ? home.resolve("ShinJin_POP_REWORK/demo/prelogin-details.json") : Path.of(configured)).normalize();
        if (!file.isAbsolute() || file.getFileName()==null) throw new IllegalArgumentException("An absolute local settings file is required");
    }
    public Optional<LocalPin> pin(String terminalId,String plant,String center,HttpServletRequest request) {
        String browser = cookieHash(request);
        if (browser==null) return Optional.empty();
        Key key = new Key(browser,terminalId,plant,center);
        return entries().stream().filter(e->key.equals(e.key())).findFirst().map(Entry::pin);
    }
    public record SavedFlags(LocalPin pin, Boolean machineReady, Set<String> sections) {}
    public SavedFlags savedFlags(String terminal,String plant,String center,HttpServletRequest request) {
        var browser=cookieHash(request);
        var entry=browser==null ? null : current(new Key(browser,terminal,plant,center));
        return entry==null ? new SavedFlags(EMPTY,null,Set.of())
                : new SavedFlags(entry.pin(),entry.machineReady(),Set.copyOf(entry.sections().keySet()));
    }
    private static String cookieHash(HttpServletRequest request) {
        if(request.getAttribute(PENDING) instanceof String issued) return issued;
        Cookie[] cookies=request.getCookies();
        if (cookies!=null) for (Cookie c:cookies) {
            if (COOKIE.equals(c.getName()) && c.getValue().matches("[A-Za-z0-9_-]{43}")) return hash(c.getValue());
        }
        return null;
    }
    private static String hash(String raw) {
        try {return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(raw.getBytes(java.nio.charset.StandardCharsets.US_ASCII)));}
        catch (NoSuchAlgorithmException e) {throw new IllegalStateException(e);}
    }
    String browser(HttpServletRequest request,HttpServletResponse response,boolean create) {
        String known=cookieHash(request);
        var session=request.getSession(create);
        if (known!=null && ((session!=null && known.equals(session.getAttribute(PENDING))) ||
                entries().stream().anyMatch(e->known.equals(e.key().browser())))) return known;
        if (!create) throw new ResponseStatusException(HttpStatus.CONFLICT,"BROWSER_REQUIRED");
        // Concurrent first reads in the same servlet session receive the same issued cookie.
        synchronized (session) {
            String raw=(String)session.getAttribute(PENDING+".raw");
            if (raw==null) {
                byte[] random=new byte[32];RANDOM.nextBytes(random);
                raw=Base64.getUrlEncoder().withoutPadding().encodeToString(random);
                session.setAttribute(PENDING+".raw",raw);
                session.setAttribute(PENDING,hash(raw));
            }
            response.addHeader("Set-Cookie",ResponseCookie.from(COOKIE,raw).httpOnly(true).secure(request.isSecure())
                    .sameSite("Strict").path(request.getContextPath().isEmpty()?"/":request.getContextPath()).maxAge(Duration.ofDays(730)).build().toString());
            String hash=hash(raw);
            request.setAttribute(PENDING,hash);
            return hash;
        }
    }
    public void initializeBrowser(HttpServletRequest request,HttpServletResponse response) {
        browser(request,response,true);
    }
    Entry current(Key key) {return find(entries(),key);}
    private static Entry find(List<Entry> entries,Key key) {
        return entries.stream().filter(e->key.equals(e.key())).findFirst().orElseGet(()->new Entry(key,0,EMPTY,null,Map.of()));
    }
    public <T> Optional<T> local(String terminal,String plant,String center,String section,Class<T> type,HttpServletRequest request) {
        String browser=cookieHash(request);
        if(browser==null)return Optional.empty();
        var field=current(new Key(browser,terminal,plant,center)).sections().get(section);
        return field==null?Optional.empty():Optional.of(JSON.treeToValue(field,type));
    }
    public long localVersion(String terminal,String plant,String center,String section,HttpServletRequest request) {
        String browser=cookieHash(request);
        return browser==null?0:current(new Key(browser,terminal,plant,center)).version();
    }
    public <T> long saveLocal(String terminal,String plant,String center,String section,Long expected,T value,
                             HttpServletRequest request,HttpServletResponse response) {
        return saveLocal(terminal,plant,center,section,expected,value,request,response,null);
    }

    <T> long saveLocal(String terminal,String plant,String center,String section,Long expected,T value,
                       HttpServletRequest request,HttpServletResponse response,Long expectedSiteVersion) {
        var key=new Key(browser(request,response,true),terminal,plant,center);
        return write(key,(rows,previous)->{
            if (expectedSiteVersion!=null && expectedSiteVersion!=find(rows,new Key(key.browser(),terminal,"","")).version())
                throw new ResponseStatusException(HttpStatus.PRECONDITION_FAILED,"SITE_CHANGED");
            if (!Objects.equals(expected,previous.version())) throw new ResponseStatusException(HttpStatus.CONFLICT,"STALE_SETTINGS");
            if (section.equals("plant")) {
                // frmPlant resets process, equipment, POP ID, group, material and warehouse files even on reselect.
                rows.replaceAll(row -> row.key().browser().equals(key.browser()) && row.key().terminal().equals(terminal)
                        && !row.key().plant().isEmpty() ? new Entry(row.key(),Math.incrementExact(row.version()),EMPTY,false,Map.of()) : row);
            }
            var sections=new HashMap<>(previous.sections());
            sections.put(section,JSON.valueToTree(value));
            var pin=previous.pin();
            Boolean ready=previous.machineReady();
            if(section.equals("machine")) {
                ready=true;
                pin=new LocalPin(pin.slots(),List.of(),pin.warehouses());
            }
            return new Entry(key,Math.incrementExact(previous.version()),pin,ready,sections);
        }).version();
    }
    private List<Entry> entries() {
        try {
            byte[] data=Files.readAllBytes(file);
            var doc=JSON.readValue(data,Document.class);
            if (doc==null || doc.format()!=1 || doc.entries()==null) throw new IOException("invalid settings document");
            var seen=new HashSet<Key>();
            for (Entry e:doc.entries()) if (e==null || e.key()==null || e.pin()==null || e.version()<1 || !seen.add(e.key()))
                throw new IOException("invalid settings entry");
            return doc.entries();
        } catch (NoSuchFileException missing) {return List.of();}
        catch (IOException | RuntimeException failure) {throw unavailable();}
    }
    public void saveAuthenticatedProcesses(String terminalId,String plant,String center,Map<Integer,String> nativeCodes,
                                            HttpServletRequest request,HttpServletResponse response) {
        var actor=com.shinjin.pop.history.DemoSessionController.requireIdentity(request);
        if (!actor.terminal().id().equals(terminalId)) throw new ResponseStatusException(HttpStatus.FORBIDDEN,"TERMINAL_SCOPE");
        if (plant==null || plant.isBlank() || center==null || center.isBlank() || nativeCodes==null)
            throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_PROCESS");
        Map<Integer,String> slots=new TreeMap<>();
        nativeCodes.forEach((slot,code)->{
            if (slot==null || slot<1 || slot>6 || code==null) throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_PROCESS");
            if (!code.isBlank()) slots.put(slot,code);
        });
        if (slots.isEmpty()) throw new ResponseStatusException(HttpStatus.UNPROCESSABLE_ENTITY,"INVALID_PROCESS");
        var key=new Key(browser(request,response,true),terminalId,plant,center);
        commit(key,null,false,false,old->new LocalPin(slots,List.of(),old.pin().warehouses()));
    }
    void saveAuthenticatedMachines(String terminalId,String plant,String center,HttpServletRequest request,HttpServletResponse response) {
        // The caller has verified administrator, terminal, revision, and all selected machines.
        var key=new Key(browser(request,response,true),terminalId,plant,center);
        commit(key,null,false,true,old->new LocalPin(old.pin().slots(),List.of(),old.pin().warehouses()));
    }
    Entry save(Key key,Long expected,Boolean machineReady,Function<Entry,LocalPin> update) {
        return commit(key,expected,true,machineReady,update);
    }
    private Entry commit(Key key,Long expected,boolean checkVersion,Boolean machineReady,Function<Entry,LocalPin> update) {
        return write(key,(rows,previous)->{
            if (checkVersion && !Objects.equals(expected,previous.version())) throw new ResponseStatusException(HttpStatus.CONFLICT,"STALE_SETTINGS");
            var sections=new HashMap<>(previous.sections());
            if(Boolean.FALSE.equals(machineReady)) {sections.remove("machine");sections.remove("popId");}
            return new Entry(key,Math.incrementExact(previous.version()),update.apply(previous),
                    machineReady==null ? previous.machineReady() : machineReady,sections);
        });
    }
    private Entry write(Key key,java.util.function.BiFunction<List<Entry>,Entry,Entry> update) {
        synchronized (FILE_LOCK) {
            try {
                Files.createDirectories(file.getParent());
                Path lock=file.resolveSibling(file.getFileName()+".lock");
                try (var channel=FileChannel.open(lock,CREATE,WRITE);var held=channel.lock()) {
                    var rows=new ArrayList<>(entries());
                    var previous=find(rows,key);
                    Entry next=update.apply(rows,previous);
                    rows.removeIf(row->key.equals(row.key()));rows.add(next);
                    byte[] serialized=JSON.writeValueAsBytes(new Document(1,rows));
                    Path temp=Files.createTempFile(file.getParent(),".pop-settings-",".tmp");
                    try {
                        try (var out=FileChannel.open(temp,WRITE,TRUNCATE_EXISTING)) {
                            var buffer=ByteBuffer.wrap(serialized);while (buffer.hasRemaining()) out.write(buffer);
                            out.force(true);
                        }
                        Files.move(temp,file,StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);
                    } finally {Files.deleteIfExists(temp);}
                    return next;
                }
            } catch (IOException failure) {throw unavailable();}
        }
    }
    private static ResponseStatusException unavailable() {return new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"LOCAL_STORE_UNAVAILABLE");}
}
